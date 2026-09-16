package callbackedge

import (
	"encoding/base64"
	"strings"
	"testing"
)

const validStateFixture = "0123456789_abcdefghijklmnopqrstuvwxyz-ABCDE"

func TestBoundedCallbackPreservesExactRawQueryInSafeEncoding(t *testing.T) {
	for _, query := range []string{
		"state=" + validStateFixture + "&code=synthetic%2Bcode%3D",
		"state=" + validStateFixture + "&code=synthetic-code&code=duplicate",
		"code=synthetic-code&response_type=code&state=r1_" + validStateFixture,
		"state=short&code=x&scope=unknown",
	} {
		handoff, err := ParseForwardedCallback("GET", CallbackPath, query)
		decoded, decodeError := base64.RawURLEncoding.DecodeString(handoff.EncodedQuery)
		if err != nil || decodeError != nil || string(decoded) != query {
			t.Fatalf("expected exact bounded query handoff for %q: %#v %v %v", query, handoff, err, decodeError)
		}
	}
}

func TestForwardedHeaderEventAcceptsStructurallyValidBodylessCallback(t *testing.T) {
	rawQuery := "state=" + validStateFixture + "&code=synthetic-code"
	handoff, err := ParseForwardedHeaderCallback("GET", CallbackPath, rawQuery, [][2]string{{"content-length", "0"}})
	decoded, decodeError := base64.RawURLEncoding.DecodeString(handoff.EncodedQuery)
	if err != nil || decodeError != nil || string(decoded) != rawQuery {
		t.Fatalf("expected the bodyless forwarded callback to pass the header event: %#v %v", handoff, err)
	}
}

func TestFiniteDiagnosticLabelsMirrorTheProductionParserWithoutRequestValues(t *testing.T) {
	validQuery := "state=" + validStateFixture + "&code=synthetic-code"
	overHeaderLimit := make([][2]string, MaxInputHeaderCount+1)
	for index := range overHeaderLimit {
		overHeaderLimit[index] = [2]string{"x", "y"}
	}
	tests := []struct {
		name    string
		method  string
		path    string
		query   string
		headers [][2]string
		reason  RejectionReason
	}{
		{name: "accepted", method: "GET", path: CallbackPath, query: validQuery, reason: RejectionNone},
		{name: "header bounds", method: "GET", path: CallbackPath, query: validQuery, headers: overHeaderLimit, reason: RejectionHeaderBounds},
		{name: "header spoofing", method: "GET", path: CallbackPath, query: validQuery, headers: [][2]string{{"x-forwarded-host", "example.invalid"}}, reason: RejectionHeaderSpoofing},
		{name: "transfer encoding", method: "GET", path: CallbackPath, query: validQuery, headers: [][2]string{{"transfer-encoding", "chunked"}}, reason: RejectionTransferEncoding},
		{name: "expect", method: "GET", path: CallbackPath, query: validQuery, headers: [][2]string{{"expect", "100-continue"}}, reason: RejectionExpect},
		{name: "duplicate content length", method: "GET", path: CallbackPath, query: validQuery, headers: [][2]string{{"content-length", "0"}, {"Content-Length", "0"}}, reason: RejectionDuplicateContentLength},
		{name: "nonzero content length", method: "GET", path: CallbackPath, query: validQuery, headers: [][2]string{{"content-length", "1"}}, reason: RejectionNonzeroContentLength},
		{name: "target mismatch", method: "GET", path: CallbackPath + "?" + validQuery, query: validQuery + "x", reason: RejectionTargetMismatch},
		{name: "method", method: "POST", path: CallbackPath, query: validQuery, reason: RejectionMethod},
		{name: "path", method: "GET", path: "/", query: validQuery, reason: RejectionPath},
		{name: "query empty", method: "GET", path: CallbackPath, query: "", reason: RejectionQueryEmpty},
		{name: "query limit", method: "GET", path: CallbackPath, query: strings.Repeat("x", MaxRawQueryBytes+1), reason: RejectionQueryLimit},
		{name: "query unsafe", method: "GET", path: CallbackPath, query: validQuery + "#fragment", reason: RejectionQueryUnsafe},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handoff, reason := DiagnoseForwardedHeaderCallback(test.method, test.path, test.query, test.headers)
			parsed, err := ParseForwardedHeaderCallback(test.method, test.path, test.query, test.headers)
			if reason != test.reason {
				t.Fatalf("expected %q, got %q", test.reason, reason)
			}
			if reason == RejectionNone {
				if err != nil || parsed != handoff || handoff.EncodedQuery == "" {
					t.Fatalf("diagnostic and production parser diverged: %#v %#v %v", handoff, parsed, err)
				}
				return
			}
			if err != ErrInvalidRequest || parsed != (Handoff{}) || handoff != (Handoff{}) {
				t.Fatalf("rejected diagnostic changed production behavior: %#v %#v %v", handoff, parsed, err)
			}
			if strings.Contains(string(reason), "synthetic") || strings.Contains(string(reason), "example") {
				t.Fatalf("diagnostic reflected a request value: %q", reason)
			}
		})
	}
}

func TestEquivalentForwardedTargetRepresentationsAreAccepted(t *testing.T) {
	rawQuery := "state=" + validStateFixture + "&code=" + strings.Repeat("x", 191)
	for _, target := range []struct{ path, query string }{
		{path: CallbackPath, query: rawQuery},
		{path: CallbackPath, query: "?" + rawQuery},
		{path: CallbackPath + "?" + rawQuery, query: rawQuery},
		{path: CallbackPath + "?" + rawQuery, query: "?" + rawQuery},
	} {
		handoff, err := ParseForwardedCallback("GET", target.path, target.query)
		decoded, decodeError := base64.RawURLEncoding.DecodeString(handoff.EncodedQuery)
		if err != nil || decodeError != nil || string(decoded) != rawQuery {
			t.Fatalf("expected equivalent forwarded target to pass: %#v %#v %v", target, handoff, err)
		}
	}
}

func TestOnlyMalformedEnvelopesFailAtEdge(t *testing.T) {
	queries := []string{
		"",
		"state=" + validStateFixture + "&code=x#fragment",
		"state=" + validStateFixture + "&code=x\\suffix",
		"state=" + validStateFixture + "&code=raw space",
		"state=" + validStateFixture + "&code=\u00e9",
		"state=" + validStateFixture + "&code=" + strings.Repeat("x", MaxRawQueryBytes),
	}
	for _, query := range queries {
		if _, err := ParseForwardedCallback("GET", CallbackPath, query); err == nil {
			t.Fatalf("expected malformed edge envelope to fail: %q", query)
		}
	}
	if _, err := ParseForwardedCallback("POST", CallbackPath, "state="+validStateFixture+"&code=x"); err == nil {
		t.Fatal("expected unsupported method to fail")
	}
	for _, target := range []struct{ path, query string }{
		{path: "/", query: "state=" + validStateFixture + "&code=x"},
		{path: CallbackPath + "?state=" + validStateFixture + "&code=x", query: "state=" + validStateFixture + "&code=y"},
		{path: CallbackPath + "?state=" + validStateFixture + "&code=x", query: ""},
	} {
		if _, err := ParseForwardedCallback("GET", target.path, target.query); err == nil {
			t.Fatalf("expected mismatched forwarded target to fail: %#v", target)
		}
	}
}

func TestBodyIndicatorHeadersFailClosed(t *testing.T) {
	for _, headers := range [][][2]string{
		{{"content-length", "1"}},
		{{"content-length", "0"}, {"Content-Length", "0"}},
		{{"transfer-encoding", "chunked"}},
		{{"Transfer-Encoding", "identity"}},
		{{"expect", "100-continue"}},
	} {
		if !HasForbiddenCallbackBodyHeaders(headers) {
			t.Fatalf("expected body-indicator headers to fail: %#v", headers)
		}
		if _, err := ParseForwardedHeaderCallback(
			"GET", CallbackPath, "state="+validStateFixture+"&code=synthetic-code", headers,
		); err == nil {
			t.Fatalf("expected complete forwarded-header contract to fail: %#v", headers)
		}
	}
	for _, headers := range [][][2]string{
		nil,
		{{"content-length", "0"}},
		{{"Content-Length", " 0 "}},
		{{"accept", "text/html"}},
	} {
		if HasForbiddenCallbackBodyHeaders(headers) {
			t.Fatalf("expected bodyless headers to pass: %#v", headers)
		}
		if handoff, err := ParseForwardedHeaderCallback(
			"GET", CallbackPath, "state="+validStateFixture+"&code=synthetic-code", headers,
		); err != nil || handoff.EncodedQuery == "" {
			t.Fatalf("expected complete forwarded-header contract to pass: %#v %#v %v", headers, handoff, err)
		}
	}
}

func TestCompleteClientHeaderMapRejectsAuthorityAliasesAndReservedHandoffs(t *testing.T) {
	for _, name := range []string{
		"forwarded",
		"x-forwarded-host",
		"x-original-url",
		"x-rewrite-url",
		HandoffVersionHeader,
		HandoffQueryHeader,
		HandoffCodeHeader,
		HandoffStateHeader,
		HandoffDeniedHeader,
	} {
		headers := [][2]string{{name, "synthetic"}}
		if !HasForbiddenClientHeaders(headers) {
			t.Fatalf("expected %s to fail the complete client header contract", name)
		}
		if _, err := ParseForwardedHeaderCallback(
			"GET", CallbackPath, "state="+validStateFixture+"&code=synthetic-code", headers,
		); err == nil {
			t.Fatalf("expected %s to fail before handoff", name)
		}
	}
	if HasForbiddenClientHeaders([][2]string{{"accept", "text/html"}}) {
		t.Fatal("ordinary client headers must remain permitted within the explicit bounds")
	}
}

func TestCompleteClientHeaderMapHasExactCountAndByteBounds(t *testing.T) {
	headers := make([][2]string, MaxInputHeaderCount)
	for index := range headers {
		headers[index] = [2]string{"x", "y"}
	}
	if !IsBoundedClientHeaderMap(headers) {
		t.Fatalf("expected exactly %d small headers to remain permitted", MaxInputHeaderCount)
	}
	if IsBoundedClientHeaderMap(append(headers, [2]string{"x", "y"})) {
		t.Fatalf("expected a %dth input header to fail", MaxInputHeaderCount+1)
	}
	if !IsBoundedClientHeaderMap([][2]string{{"x", strings.Repeat("y", 8191)}, {"z", strings.Repeat("w", 8191)}}) {
		t.Fatalf("expected exactly %d aggregate bytes to remain permitted", MaxInputHeaderBytes)
	}
	if IsBoundedClientHeaderMap([][2]string{{"x", strings.Repeat("y", 8192)}, {"z", strings.Repeat("w", 8191)}}) {
		t.Fatalf("expected aggregate bytes above %d to fail", MaxInputHeaderBytes)
	}
}

func TestOnlyExactQuerylessHealthAndWebhookPassThrough(t *testing.T) {
	if !IsHealthRequest("GET", HealthPath, "") || !IsHealthRequest("HEAD", HealthPath, "") {
		t.Fatal("expected exact health requests to pass")
	}
	if !IsWebhookRequest("POST", WebhookPath, "") {
		t.Fatal("expected exact webhook request to pass")
	}
	for _, input := range []struct{ method, path, query string }{
		{method: "POST", path: HealthPath},
		{method: "GET", path: HealthPath, query: "x=1"},
		{method: "GET", path: WebhookPath},
		{method: "POST", path: WebhookPath, query: "x=1"},
		{method: "POST", path: "/api/integrations/other/webhook"},
	} {
		if IsHealthRequest(input.method, input.path, input.query) || IsWebhookRequest(input.method, input.path, input.query) {
			t.Fatalf("expected noncanonical pass-through to fail: %#v", input)
		}
	}
}
