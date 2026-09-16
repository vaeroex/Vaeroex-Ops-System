package callbackedge

import (
	"encoding/base64"
	"errors"
	"strings"
)

const (
	CallbackPath          = "/api/integrations/square/callback"
	WebhookPath           = "/api/integrations/square/webhook"
	HealthPath            = "/healthz"
	HandoffVersion        = "square_oauth_callback_handoff_v1"
	MaxInputHeaderCount   = 64
	MaxInputHeaderBytes   = 16384
	MaxRawQueryBytes      = 8192
	MaxRequestTargetBytes = len(CallbackPath) + 1 + MaxRawQueryBytes
	HandoffVersionHeader  = "x-vaeroex-oauth-handoff-version"
	HandoffQueryHeader    = "x-vaeroex-oauth-query"
	HandoffCodeHeader     = "x-vaeroex-oauth-code"
	HandoffStateHeader    = "x-vaeroex-oauth-state"
	HandoffDeniedHeader   = "x-vaeroex-oauth-denied"
)

var ErrInvalidRequest = errors.New("invalid integration request")

var ReservedHandoffHeaders = [...]string{
	HandoffVersionHeader,
	HandoffQueryHeader,
	HandoffCodeHeader,
	HandoffStateHeader,
	HandoffDeniedHeader,
}

type Handoff struct {
	EncodedQuery string
}

// ParseForwardedHeaderCallback validates the complete request contract visible
// to the REQUEST_HEADERS-only managed edge extension. Body-indicator headers
// are rejected before any callback material can be converted into an internal
// handoff.
func ParseForwardedHeaderCallback(method, pathAttribute, queryAttribute string, headers [][2]string) (Handoff, error) {
	if !IsBoundedClientHeaderMap(headers) || HasForbiddenClientHeaders(headers) || HasForbiddenCallbackBodyHeaders(headers) {
		return Handoff{}, ErrInvalidRequest
	}
	return ParseForwardedCallback(method, pathAttribute, queryAttribute)
}

// IsBoundedClientHeaderMap applies the input count and byte limits before the
// edge derives or appends any internal handoff header.
func IsBoundedClientHeaderMap(headers [][2]string) bool {
	if len(headers) > MaxInputHeaderCount {
		return false
	}
	totalBytes := 0
	for _, header := range headers {
		if len(header[0]) == 0 || len(header[0]) > 256 || len(header[1]) > 8192 {
			return false
		}
		totalBytes += len(header[0]) + len(header[1])
		if totalBytes > MaxInputHeaderBytes {
			return false
		}
	}
	return true
}

// HasForbiddenClientHeaders rejects every client-controlled authority alias
// and every header reserved for the trusted edge-to-backend handoff.
// LbEdgeExtension must omit forward_headers so this check receives the complete
// client header map rather than an allowlisted subset.
func HasForbiddenClientHeaders(headers [][2]string) bool {
	for _, header := range headers {
		name := strings.ToLower(header[0])
		switch name {
		case "forwarded", "x-forwarded-host", "x-original-url", "x-rewrite-url":
			return true
		}
		for _, reserved := range ReservedHandoffHeaders {
			if name == reserved {
				return true
			}
		}
	}
	return false
}

func ParseForwardedCallback(method, pathAttribute, queryAttribute string) (Handoff, error) {
	path, rawQuery, valid := normalizeForwardedTarget(pathAttribute, queryAttribute)
	if !valid {
		return Handoff{}, ErrInvalidRequest
	}
	if method != "GET" {
		return Handoff{}, ErrInvalidRequest
	}
	if path != CallbackPath {
		return Handoff{}, ErrInvalidRequest
	}
	if len(rawQuery) == 0 {
		return Handoff{}, ErrInvalidRequest
	}
	if len(rawQuery) > MaxRawQueryBytes {
		return Handoff{}, ErrInvalidRequest
	}
	if hasUnsafeRawQuery(rawQuery) {
		return Handoff{}, ErrInvalidRequest
	}
	return Handoff{EncodedQuery: base64.RawURLEncoding.EncodeToString([]byte(rawQuery))}, nil
}

func HasForbiddenCallbackBodyHeaders(headers [][2]string) bool {
	contentLengthCount := 0
	for _, header := range headers {
		name := strings.ToLower(header[0])
		switch name {
		case "transfer-encoding", "expect":
			return true
		case "content-length":
			contentLengthCount++
			if contentLengthCount > 1 || strings.TrimSpace(header[1]) != "0" {
				return true
			}
		}
	}
	return false
}

func IsWebhookRequest(method, pathAttribute, queryAttribute string) bool {
	path, rawQuery, valid := normalizeForwardedTarget(pathAttribute, queryAttribute)
	return valid && method == "POST" && path == WebhookPath && rawQuery == ""
}

func IsHealthRequest(method, pathAttribute, queryAttribute string) bool {
	path, rawQuery, valid := normalizeForwardedTarget(pathAttribute, queryAttribute)
	return valid && (method == "GET" || method == "HEAD") && path == HealthPath && rawQuery == ""
}

func normalizeForwardedTarget(pathAttribute, queryAttribute string) (string, string, bool) {
	rawQuery := strings.TrimPrefix(queryAttribute, "?")
	path := pathAttribute
	if pathValue, pathQuery, found := strings.Cut(pathAttribute, "?"); found {
		if pathQuery != rawQuery {
			return "", "", false
		}
		path = pathValue
	}
	return path, rawQuery, true
}

func hasUnsafeRawQuery(value string) bool {
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character <= 0x20 || character > 0x7e || character == '\\' || character == '#' {
			return true
		}
	}
	return false
}
