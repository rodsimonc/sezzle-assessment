package middleware

import (
	"net/http"

	"calculator/internal/problem"
)

// CORS answers preflights and tags responses for origins on the allowlist. With an empty list it does nothing,
// so no response carries Access-Control-Allow-Origin.
func CORS(allowed []string) func(http.Handler) http.Handler {
	set := make(map[string]struct{}, len(allowed))
	for _, origin := range allowed {
		set[origin] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		if len(set) == 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Add("Vary", "Origin")
			origin := r.Header.Get("Origin")
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}
			_, ok := set[origin]
			preflight := r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""
			switch {
			case preflight && !ok:
				problem.Write(w, r, http.StatusForbidden, problem.CodeCORSOriginNotAllowed, problem.DetailCORSOriginNotAllowed)
			case preflight:
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				h.Set("Access-Control-Allow-Headers", "Content-Type, X-Request-Id")
				h.Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
			default:
				if ok {
					h.Set("Access-Control-Allow-Origin", origin)
					h.Set("Access-Control-Expose-Headers", "X-Request-Id, Retry-After")
				}
				next.ServeHTTP(w, r)
			}
		})
	}
}
