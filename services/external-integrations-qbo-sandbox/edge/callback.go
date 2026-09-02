package callbackedge

import (
	"errors"
	"net/url"
	"strings"
)

const (
	CallbackPath          = "/oauth/callback"
	ConfirmationPath      = "/oauth/confirmed"
	HandoffVersion        = "qbo_oauth_callback_handoff_v1"
	MaxHeaderCount        = 64
	MaxRawQueryBytes      = 27000
	MaxRequestTargetBytes = len(CallbackPath) + 1 + MaxRawQueryBytes
	HandoffVersionHeader  = "x-vaeroex-oauth-handoff-version"
	HandoffCodeHeader     = "x-vaeroex-oauth-code"
	HandoffStateHeader    = "x-vaeroex-oauth-state"
	HandoffRealmIDHeader  = "x-vaeroex-oauth-realm-id"
)

var ErrInvalidCallback = errors.New("invalid oauth callback")

var ReservedHandoffHeaders = [...]string{
	HandoffVersionHeader,
	HandoffCodeHeader,
	HandoffStateHeader,
	HandoffRealmIDHeader,
}

type Handoff struct {
	Code    string
	State   string
	RealmID string
}

func ParseCallbackRequest(method, requestTarget string, endOfStream bool) (Handoff, error) {
	if len(requestTarget) > MaxRequestTargetBytes {
		return Handoff{}, ErrInvalidCallback
	}
	if strings.Contains(requestTarget, "#") || strings.Count(requestTarget, "?") != 1 {
		return Handoff{}, ErrInvalidCallback
	}

	path, rawQuery, found := strings.Cut(requestTarget, "?")
	if !found {
		return Handoff{}, ErrInvalidCallback
	}
	return ParseCallbackAttributes(method, path, rawQuery, endOfStream)
}

func ParseCallbackAttributes(method, path, rawQuery string, endOfStream bool) (Handoff, error) {
	if method != "GET" || !endOfStream || path != CallbackPath ||
		len(rawQuery) == 0 || len(rawQuery) > MaxRawQueryBytes ||
		strings.ContainsAny(rawQuery, "?#") {
		return Handoff{}, ErrInvalidCallback
	}

	parts := strings.Split(rawQuery, "&")
	if len(parts) != 3 {
		return Handoff{}, ErrInvalidCallback
	}

	values := make(map[string]string, 3)
	for _, part := range parts {
		key, rawValue, ok := strings.Cut(part, "=")
		if !ok || rawValue == "" || (key != "code" && key != "state" && key != "realmId") {
			return Handoff{}, ErrInvalidCallback
		}
		if _, duplicate := values[key]; duplicate {
			return Handoff{}, ErrInvalidCallback
		}
		value, err := url.QueryUnescape(rawValue)
		if err != nil {
			return Handoff{}, ErrInvalidCallback
		}
		values[key] = value
	}

	handoff := Handoff{
		Code:    values["code"],
		State:   values["state"],
		RealmID: values["realmId"],
	}
	if !validCode(handoff.Code) || !validState(handoff.State) || !validRealmID(handoff.RealmID) {
		return Handoff{}, ErrInvalidCallback
	}
	return handoff, nil
}

func ParseForwardedCallback(method, pathAttribute, queryAttribute string) (Handoff, error) {
	path, rawQuery, valid := normalizeForwardedTarget(pathAttribute, queryAttribute)
	if !valid {
		return Handoff{}, ErrInvalidCallback
	}
	return ParseCallbackAttributes(method, path, rawQuery, true)
}

func IsConfirmationRequest(method, pathAttribute, queryAttribute string) bool {
	path, rawQuery, valid := normalizeForwardedTarget(pathAttribute, queryAttribute)
	return valid && method == "GET" && path == ConfirmationPath && rawQuery == ""
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

func validCode(value string) bool {
	if len(value) < 8 || len(value) > 8192 {
		return false
	}
	for i := 0; i < len(value); i++ {
		if value[i] < 0x21 || value[i] > 0x7e {
			return false
		}
	}
	return true
}

func validState(value string) bool {
	if len(value) < 32 || len(value) > 512 {
		return false
	}
	for i := 0; i < len(value); i++ {
		character := value[i]
		if !asciiAlphaNumeric(character) && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func validRealmID(value string) bool {
	if len(value) < 1 || len(value) > 128 || !asciiAlphaNumeric(value[0]) {
		return false
	}
	for i := 1; i < len(value); i++ {
		character := value[i]
		if !asciiAlphaNumeric(character) && !strings.ContainsRune("._:/-", rune(character)) {
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
