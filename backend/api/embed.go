// Package api embeds the OpenAPI document so the binary serves the exact file it was built with.
package api

import _ "embed"

// Spec holds the bytes of openapi.yaml.
//
//go:embed openapi.yaml
var Spec []byte
