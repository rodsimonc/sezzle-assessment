package middleware

import (
	"context"
	"math"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"calculator/internal/problem"
)

// RateLimitOptions configures RateLimit. A PerMinute of 0 turns the limiter off.
type RateLimitOptions struct {
	PerMinute  int
	Burst      int
	TrustProxy bool
	// Now is the clock. It defaults to time.Now and exists so tests can drive time.
	Now func() time.Time
	// SweepEvery is how often the janitor evicts idle buckets. It defaults to one minute.
	SweepEvery time.Duration
}

type bucket struct {
	tokens float64
	last   time.Time
}

// limiter is a token bucket per client key. Tokens refill at rate per second up to burst.
type limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64
	burst   float64
	now     func() time.Time
}

func newLimiter(opts RateLimitOptions) *limiter {
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	return &limiter{
		buckets: make(map[string]*bucket),
		rate:    float64(opts.PerMinute) / 60,
		burst:   float64(opts.Burst),
		now:     now,
	}
}

// allow takes one token for key. When none is left it returns the wait in whole seconds, at least 1.
func (l *limiter) allow(key string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	if elapsed := now.Sub(b.last).Seconds(); elapsed > 0 {
		b.tokens = math.Min(l.burst, b.tokens+elapsed*l.rate)
	}
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	// Fewer than 1 token means the wait is positive, so rounding up gives at least 1 second.
	return false, int(math.Ceil((1 - b.tokens) / l.rate))
}

// sweep drops buckets that have been idle long enough to refill completely. A refilled bucket
// equals a fresh one, so dropping it changes no answer.
func (l *limiter) sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	refill := time.Duration(l.burst / l.rate * float64(time.Second))
	for key, b := range l.buckets {
		if now.Sub(b.last) >= refill {
			delete(l.buckets, key)
		}
	}
}

func (l *limiter) size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

// janitor sweeps on a ticker until ctx ends.
func (l *limiter) janitor(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.sweep()
		}
	}
}

// RateLimit guards /api/ routes with a token bucket per client. Health checks and static files pass freely.
// The janitor goroutine stops when ctx ends.
func RateLimit(ctx context.Context, opts RateLimitOptions) func(http.Handler) http.Handler {
	if opts.PerMinute <= 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	l := newLimiter(opts)
	every := opts.SweepEvery
	if every <= 0 {
		every = time.Minute
	}
	go l.janitor(ctx, every)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !IsAPIPath(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			ok, wait := l.allow(clientKey(r, opts.TrustProxy))
			if ok {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Retry-After", strconv.Itoa(wait))
			problem.Write(w, r, http.StatusTooManyRequests, problem.CodeRateLimited, problem.RateLimitedDetail(wait), problem.WithRetryAfter(wait))
		})
	}
}

// clientKey is the remote address. With a trusted proxy it's the first X-Forwarded-For entry,
// as long as that entry is an IP address.
func clientKey(r *http.Request, trustProxy bool) string {
	if trustProxy {
		first, _, _ := strings.Cut(r.Header.Get("X-Forwarded-For"), ",")
		if addr, err := netip.ParseAddr(strings.TrimSpace(first)); err == nil {
			return addr.String()
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
