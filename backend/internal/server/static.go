package server

import (
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path"
	"strings"

	"calculator/internal/handler"
)

const (
	indexFile       = "index.html"
	assetsPrefix    = "/assets/"
	cacheImmutable  = "public, max-age=31536000, immutable"
	cacheRevalidate = "no-cache"
)

// contentTypes covers what a Vite build emits. Windows reads MIME types from the registry,
// which can map .js to text/plain, so the common ones are fixed here.
var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json",
	".map":         "application/json",
	".webmanifest": "application/manifest+json",
	".txt":         "text/plain; charset=utf-8",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".ico":         "image/x-icon",
	".woff2":       "font/woff2",
}

// newStatic serves the built frontend from dir. An empty dir makes the service API-only, so every
// non-API path is a 404 Problem.
func newStatic(dir string, logger *slog.Logger) http.Handler {
	if dir == "" {
		return http.HandlerFunc(handler.NotFound)
	}
	if !staticDirExists(dir) {
		logger.Warn("STATIC_DIR is not a directory, static files will answer 404", "staticDir", dir)
	}
	return &staticHandler{files: os.DirFS(dir)}
}

type staticHandler struct {
	files fs.FS
}

func (s *staticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		handler.MethodNotAllowed(w, r, http.MethodGet, http.MethodHead)
		return
	}
	// Cleaning an absolute path removes every ".." before the name reaches the file system.
	// os.DirFS also refuses names with backslashes or drive colons on Windows.
	clean := path.Clean("/" + r.URL.Path)
	name := strings.TrimPrefix(clean, "/")
	if name == "" {
		name = indexFile
	}
	if s.serve(w, r, name, clean) {
		return
	}
	// A missing hashed asset is a real 404. Serving the page for it would hide a broken deploy.
	if strings.HasPrefix(clean, assetsPrefix) || !s.serve(w, r, indexFile, "/"+indexFile) {
		handler.NotFound(w, r)
	}
}

// serve writes the file called name and reports whether it found a regular file.
func (s *staticHandler) serve(w http.ResponseWriter, r *http.Request, name, urlPath string) bool {
	f, err := s.files.Open(name)
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return false
	}
	content, ok := f.(io.ReadSeeker)
	if !ok {
		return false
	}
	h := w.Header()
	if ct, known := contentTypes[strings.ToLower(path.Ext(name))]; known {
		h.Set("Content-Type", ct)
	} else if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
		h.Set("Content-Type", ct)
	}
	if strings.HasPrefix(urlPath, assetsPrefix) {
		h.Set("Cache-Control", cacheImmutable)
	} else {
		h.Set("Cache-Control", cacheRevalidate)
	}
	http.ServeContent(w, r, name, info.ModTime(), content)
	return true
}
