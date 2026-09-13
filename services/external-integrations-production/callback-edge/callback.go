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

func ParseForwardedCallback(method, pathAttribute, queryAttribute string, endOfStream bool) (Handoff, error) {
	path, rawQuery, valid := normalizeForwardedTarget(pathAttribute, queryAttribute)
	if !valid || method != "GET" || !endOfStream || path != CallbackPath ||
		len(rawQuery) == 0 || len(rawQuery) > MaxRawQueryBytes || hasUnsafeRawQuery(rawQuery) {
		return Handoff{}, ErrInvalidRequest
	}

	parts := strings.Split(rawQuery, "&")
	if len(parts) < 2 || len(parts) > 3 {
		return Handoff{}, ErrInvalidRequest
	}
	values := make(map[string]string, len(parts))
	for _, part := range parts {
		key, rawValue, ok := strings.Cut(part, "=")
		if !ok || rawValue == "" || !allowedCallbackKey(key) {
			return Handoff{}, ErrInvalidRequest
		}
		if _, duplicate := values[key]; duplicate {
			return Handoff{}, ErrInvalidRequest
		}
		value, err := url.QueryUnescape(rawValue)
		if err != nil || len(value) == 0 || len(value) > 2048 || hasHeaderUnsafeValue(value) {
			return Handoff{}, ErrInvalidRequest
		}
		values[key] = value
	}

	state := values["state"]
	if !validState(state) {
		return Handoff{}, ErrInvalidRequest
	}
	if _, denied := values["error"]; denied {
		if _, hasCode := values["code"]; hasCode {
			return Handoff{}, ErrInvalidRequest
		}
		if _, hasResponseType := values["response_type"]; hasResponseType {
			return Handoff{}, ErrInvalidRequest
		}
		return Handoff{State: state, Denied: true}, nil
	}
	if _, hasDescription := values["error_description"]; hasDescription {
		return Handoff{}, ErrInvalidRequest
	}
	code := values["code"]
	if !validCode(code) {
		return Handoff{}, ErrInvalidRequest
	}
	if responseType, present := values["response_type"]; present && responseType != "code" {
		return Handoff{}, ErrInvalidRequest
	}
	return Handoff{Code: code, State: state}, nil
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
		if value[index] <= 0x20 || value[index] == 0x7f {
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
