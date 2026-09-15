package callbackedge

import (
	"errors"
	"net/url"
	"strings"
)

const (
	CallbackPath          = "/api/integrations/square/callback"
	WebhookPath           = "/api/integrations/square/webhook"
	HealthPath            = "/healthz"
	HandoffVersion        = "square_oauth_callback_handoff_v1"
	MaxHeaderCount        = 64
	MaxRawQueryBytes      = 8192
	MaxRequestTargetBytes = len(CallbackPath) + 1 + MaxRawQueryBytes
	HandoffVersionHeader  = "x-vaeroex-oauth-handoff-version"
	HandoffCodeHeader     = "x-vaeroex-oauth-code"
	HandoffStateHeader    = "x-vaeroex-oauth-state"
	HandoffDeniedHeader   = "x-vaeroex-oauth-denied"
)

var ErrInvalidRequest = errors.New("invalid integration request")

type RejectionReason string

const (
	RejectionNone             RejectionReason = "accepted"
	RejectionBodyIndicator    RejectionReason = "body_indicator"
	RejectionTargetMismatch   RejectionReason = "target_mismatch"
	RejectionMethod           RejectionReason = "method"
	RejectionPath             RejectionReason = "path"
	RejectionQueryEmpty       RejectionReason = "query_empty"
	RejectionQueryLimit       RejectionReason = "query_limit"
	RejectionQueryUnsafe      RejectionReason = "query_unsafe"
	RejectionPartCount        RejectionReason = "part_count"
	RejectionPairShape        RejectionReason = "pair_shape"
	RejectionUnknownKey       RejectionReason = "unknown_key"
	RejectionDuplicateKey     RejectionReason = "duplicate_key"
	RejectionValue            RejectionReason = "value"
	RejectionState            RejectionReason = "state"
	RejectionConflictingShape RejectionReason = "conflicting_shape"
	RejectionCode             RejectionReason = "code"
	RejectionResponseType     RejectionReason = "response_type"
)

var ReservedHandoffHeaders = [...]string{
	HandoffVersionHeader,
	HandoffCodeHeader,
	HandoffStateHeader,
	HandoffDeniedHeader,
}

type Handoff struct {
	Code   string
	State  string
	Denied bool
}

// ParseForwardedHeaderCallback validates the complete request contract visible
// to the REQUEST_HEADERS-only managed edge extension. Body-indicator headers
// are rejected before any callback material can be converted into an internal
// handoff.
func ParseForwardedHeaderCallback(method, pathAttribute, queryAttribute string, headers [][2]string) (Handoff, error) {
	handoff, reason := DiagnoseForwardedHeaderCallback(method, pathAttribute, queryAttribute, headers)
	if reason != RejectionNone {
		return Handoff{}, ErrInvalidRequest
	}
	return handoff, nil
}

func ParseForwardedCallback(method, pathAttribute, queryAttribute string) (Handoff, error) {
	handoff, reason := diagnoseForwardedCallback(method, pathAttribute, queryAttribute)
	if reason != RejectionNone {
		return Handoff{}, ErrInvalidRequest
	}
	return handoff, nil
}

// DiagnoseForwardedHeaderCallback returns only a finite predicate label. It is
// used by the temporary, explicit synthetic canary and never includes request
// values, headers, callback material, or provider data.
func DiagnoseForwardedHeaderCallback(method, pathAttribute, queryAttribute string, headers [][2]string) (Handoff, RejectionReason) {
	if HasForbiddenCallbackBodyHeaders(headers) {
		return Handoff{}, RejectionBodyIndicator
	}
	return diagnoseForwardedCallback(method, pathAttribute, queryAttribute)
}

func diagnoseForwardedCallback(method, pathAttribute, queryAttribute string) (Handoff, RejectionReason) {
	path, rawQuery, valid := normalizeForwardedTarget(pathAttribute, queryAttribute)
	if !valid {
		return Handoff{}, RejectionTargetMismatch
	}
	if method != "GET" {
		return Handoff{}, RejectionMethod
	}
	if path != CallbackPath {
		return Handoff{}, RejectionPath
	}
	if len(rawQuery) == 0 {
		return Handoff{}, RejectionQueryEmpty
	}
	if len(rawQuery) > MaxRawQueryBytes {
		return Handoff{}, RejectionQueryLimit
	}
	if hasUnsafeRawQuery(rawQuery) {
		return Handoff{}, RejectionQueryUnsafe
	}

	parts := strings.Split(rawQuery, "&")
	if len(parts) < 2 || len(parts) > 3 {
		return Handoff{}, RejectionPartCount
	}
	values := make(map[string]string, len(parts))
	for _, part := range parts {
		key, rawValue, ok := strings.Cut(part, "=")
		if !ok || rawValue == "" {
			return Handoff{}, RejectionPairShape
		}
		if !allowedCallbackKey(key) {
			return Handoff{}, RejectionUnknownKey
		}
		if _, duplicate := values[key]; duplicate {
			return Handoff{}, RejectionDuplicateKey
		}
		value, err := url.QueryUnescape(rawValue)
		if err != nil || len(value) == 0 || len(value) > 2048 || hasHeaderUnsafeValue(value) {
			return Handoff{}, RejectionValue
		}
		values[key] = value
	}

	state := values["state"]
	if !validState(state) {
		return Handoff{}, RejectionState
	}
	if _, denied := values["error"]; denied {
		if _, hasCode := values["code"]; hasCode {
			return Handoff{}, RejectionConflictingShape
		}
		if _, hasResponseType := values["response_type"]; hasResponseType {
			return Handoff{}, RejectionConflictingShape
		}
		return Handoff{State: state, Denied: true}, RejectionNone
	}
	if _, hasDescription := values["error_description"]; hasDescription {
		return Handoff{}, RejectionConflictingShape
	}
	code := values["code"]
	if !validCode(code) {
		return Handoff{}, RejectionCode
	}
	if responseType, present := values["response_type"]; present && responseType != "code" {
		return Handoff{}, RejectionResponseType
	}
	return Handoff{Code: code, State: state}, RejectionNone
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

func allowedCallbackKey(value string) bool {
	return value == "state" || value == "code" || value == "response_type" ||
		value == "error" || value == "error_description"
}

func hasUnsafeRawQuery(value string) bool {
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character <= 0x20 || character == 0x7f || character == '\\' || character == '#' {
			return true
		}
	}
	return false
}

func hasHeaderUnsafeValue(value string) bool {
	for index := 0; index < len(value); index++ {
		if value[index] < 0x20 || value[index] == 0x7f {
			return true
		}
	}
	return false
}

func validCode(value string) bool {
	if len(value) < 1 || len(value) > 191 {
		return false
	}
	for index := 0; index < len(value); index++ {
		if value[index] <= 0x20 || value[index] > 0x7e {
			return false
		}
	}
	return true
}

func validState(value string) bool {
	if strings.HasPrefix(value, "r1_") {
		value = strings.TrimPrefix(value, "r1_")
	}
	if len(value) != 43 {
		return false
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if !asciiAlphaNumeric(character) && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func asciiAlphaNumeric(value byte) bool {
	return (value >= 'A' && value <= 'Z') ||
		(value >= 'a' && value <= 'z') ||
		(value >= '0' && value <= '9')
}
