package callbackedge

import (
	"errors"
	"strings"
	"testing"
)

const validStateCanary = "p8bSyntheticState_0123456789-abcdefABCDEF"

func TestParseCallbackRequestAcceptsExactBoundedShape(t *testing.T) {
	handoff, err := ParseCallbackRequest(
		"GET",
		CallbackPath+"?code=synthetic%2Bcode%3D&state="+validStateCanary+"&realmId=9341455200012345",
		true,
	)
	if err != nil {
		t.Fatalf("expected valid callback: %v", err)
	}
	if handoff.Code != "synthetic+code=" || handoff.State != validStateCanary || handoff.RealmID != "9341455200012345" {
		t.Fatalf("unexpected handoff: %#v", handoff)
	}
}

func TestParseCallbackAttributesAcceptsDocumentedRawProperties(t *testing.T) {
	handoff, err := ParseCallbackAttributes(
		"GET",
		CallbackPath,
		"realmId=9341455200012345&state="+validStateCanary+"&code=synthetic%2Bcode%3D",
		true,
	)
	if err != nil {
		t.Fatalf("expected valid callback properties: %v", err)
	}
	if handoff.Code != "synthetic+code=" || handoff.State != validStateCanary || handoff.RealmID != "9341455200012345" {
		t.Fatalf("unexpected property handoff: %#v", handoff)
	}
}

func TestParseForwardedCallbackRequiresEquivalentPlatformRepresentations(t *testing.T) {
	rawQuery := "code=synthetic-code&state=" + validStateCanary + "&realmId=9341455200012345"
	for _, input := range []struct {
		name  string
		path  string
		query string
	}{
		{name: "separate attributes", path: CallbackPath, query: rawQuery},
		{name: "structural query prefix", path: CallbackPath, query: "?" + rawQuery},
		{name: "path also carries query", path: CallbackPath + "?" + rawQuery, query: rawQuery},
	} {
		t.Run(input.name, func(t *testing.T) {
			if _, err := ParseForwardedCallback("GET", input.path, input.query); err != nil {
				t.Fatalf("expected equivalent forwarded properties: %v", err)
			}
		})
	}
	if _, err := ParseForwardedCallback("GET", CallbackPath+"?"+rawQuery, "code=different&state="+validStateCanary+"&realmId=9341455200012345"); !errors.Is(err, ErrInvalidCallback) {
		t.Fatalf("expected mismatched duplicate representation to fail closed: %v", err)
	}
}

func TestIsConfirmationRequest(t *testing.T) {
	for _, input := range []struct {
		path  string
		query string
	}{
		{path: ConfirmationPath},
		{path: ConfirmationPath, query: "?"},
		{path: ConfirmationPath + "?", query: "?"},
	} {
		if !IsConfirmationRequest("GET", input.path, input.query) {
			t.Fatal("expected the fixed query-free confirmation request to pass")
		}
	}
	for _, test := range []struct {
		method string
		path   string
		query  string
	}{
		{method: "POST", path: ConfirmationPath},
		{method: "GET", path: CallbackPath},
		{method: "GET", path: ConfirmationPath, query: "state=forbidden"},
		{method: "GET", path: ConfirmationPath + "?forged=1", query: ""},
	} {
		if IsConfirmationRequest(test.method, test.path, test.query) {
			t.Fatal("expected noncanonical confirmation request to fail")
		}
	}
}

func TestParseCallbackRequestRejectsMalformedInput(t *testing.T) {
	valid := CallbackPath + "?code=synthetic-code&state=" + validStateCanary + "&realmId=9341455200012345"
	oversized := CallbackPath + "?code=" + strings.Repeat("a", MaxRawQueryBytes) + "&state=" + validStateCanary + "&realmId=1"
	tests := []struct {
		name        string
		method      string
		target      string
		endOfStream bool
	}{
		{name: "wrong method", method: "POST", target: valid, endOfStream: true},
		{name: "body present", method: "GET", target: valid, endOfStream: false},
		{name: "wrong path", method: "GET", target: "/?code=synthetic-code&state=" + validStateCanary + "&realmId=1", endOfStream: true},
		{name: "missing query", method: "GET", target: CallbackPath, endOfStream: true},
		{name: "fragment", method: "GET", target: valid + "#fragment", endOfStream: true},
		{name: "duplicate code", method: "GET", target: valid + "&code=forged-code", endOfStream: true},
		{name: "duplicate state", method: "GET", target: valid + "&state=" + validStateCanary, endOfStream: true},
		{name: "duplicate realm", method: "GET", target: valid + "&realmId=2", endOfStream: true},
		{name: "unexpected parameter", method: "GET", target: valid + "&scope=accounting", endOfStream: true},
		{name: "encoded key", method: "GET", target: CallbackPath + "?co%64e=synthetic-code&state=" + validStateCanary + "&realmId=1", endOfStream: true},
		{name: "missing value", method: "GET", target: CallbackPath + "?code=&state=" + validStateCanary + "&realmId=1", endOfStream: true},
		{name: "bad percent encoding", method: "GET", target: CallbackPath + "?code=synthetic%ZZ&state=" + validStateCanary + "&realmId=1", endOfStream: true},
		{name: "raw form plus becomes space", method: "GET", target: CallbackPath + "?code=synthetic+code&state=" + validStateCanary + "&realmId=1", endOfStream: true},
		{name: "header injection", method: "GET", target: CallbackPath + "?code=synthetic%0Dcode&state=" + validStateCanary + "&realmId=1", endOfStream: true},
		{name: "short state", method: "GET", target: CallbackPath + "?code=synthetic-code&state=short&realmId=1", endOfStream: true},
		{name: "invalid state alphabet", method: "GET", target: CallbackPath + "?code=synthetic-code&state=" + validStateCanary + "%2F&realmId=1", endOfStream: true},
		{name: "invalid realm", method: "GET", target: CallbackPath + "?code=synthetic-code&state=" + validStateCanary + "&realmId=%2F1", endOfStream: true},
		{name: "oversized query", method: "GET", target: oversized, endOfStream: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseCallbackRequest(test.method, test.target, test.endOfStream)
			if !errors.Is(err, ErrInvalidCallback) {
				t.Fatalf("expected fixed invalid callback error, got %v", err)
			}
		})
	}
}

func TestReservedHandoffHeadersAreExact(t *testing.T) {
	expected := []string{
		"x-vaeroex-oauth-handoff-version",
		"x-vaeroex-oauth-code",
		"x-vaeroex-oauth-state",
		"x-vaeroex-oauth-realm-id",
	}
	if len(ReservedHandoffHeaders) != len(expected) {
		t.Fatalf("unexpected reserved header count: %d", len(ReservedHandoffHeaders))
	}
	for index, value := range expected {
		if ReservedHandoffHeaders[index] != value {
			t.Fatalf("unexpected reserved header at %d", index)
		}
	}
}
