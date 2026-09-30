package callbackedge

import (
	"strings"
	"testing"
)

const validStateFixture = "productionState_0123456789-abcdefABCDEF"

func TestCallbackHandoffIsExactAndQueryStripping(t *testing.T) {
	handoff, err := ParseForwardedCallback(
		"GET",
		CallbackPath,
		"realmId=9341455200012345&state="+validStateFixture+"&code=synthetic%2Bcode%3D",
		true,
	)
	if err != nil {
		t.Fatalf("expected valid callback: %v", err)
	}
	if handoff.Code != "synthetic+code=" || handoff.State != validStateFixture || handoff.RealmID != "9341455200012345" {
		t.Fatalf("unexpected handoff: %#v", handoff)
	}
	for _, query := range []string{
		"",
		"code=synthetic-code&state=" + validStateFixture,
		"code=synthetic-code&state=" + validStateFixture + "&realmId=1&realmId=2",
		"code=synthetic-code&state=" + validStateFixture + "&realmId=1&scope=forbidden",
	} {
		if _, err := ParseForwardedCallback("GET", CallbackPath, query, true); err == nil {
			t.Fatalf("expected malformed callback query to fail: %q", query)
		}
	}
}

func TestWebhookPassThroughIsExact(t *testing.T) {
	if !IsWebhookRequest("POST", WebhookPath, "") {
		t.Fatal("expected exact webhook request to pass")
	}
	for _, input := range []struct{ method, path, query string }{
		{method: "GET", path: WebhookPath},
		{method: "POST", path: WebhookPath, query: "forged=1"},
		{method: "POST", path: "/webhooks/other"},
	} {
		if IsWebhookRequest(input.method, input.path, input.query) {
			t.Fatalf("expected noncanonical webhook request to fail: %#v", input)
		}
	}
}

func TestCallbackRequiresBodylessRequest(t *testing.T) {
	query := "code=synthetic-code&state=" + validStateFixture + "&realmId=1"
	if _, err := ParseForwardedCallback("GET", CallbackPath, query, false); err == nil {
		t.Fatal("expected callback body to fail closed")
	}
}

func TestDeniedCallbackIsBoundedAndDistinct(t *testing.T) {
	for _, prefix := range []string{"i1_", "r1_"} {
		state := prefix + strings.Repeat("a", 43)
		query := "state=" + state + "&error=access_denied"
		handoff, err := ParseForwardedCallback("GET", CallbackPath+"?"+query, query, true)
		if err != nil || !handoff.Denied || handoff.State != state || handoff.Code != "" || handoff.RealmID != "" {
			t.Fatal("exact denial must carry only state and a bounded classification")
		}
	}
}

func TestMalformedDenialsFailClosed(t *testing.T) {
	state := "i1_" + strings.Repeat("a", 43)
	for _, query := range []string{
		"error=access_denied", "state=" + state, "error=access_denied&error=access_denied",
		"state=" + state + "&state=" + state,
		"state=" + state + "&error=server_error",
		"state=" + state + "&error=access_denied%0A",
		"state=" + state + "&error=access_denied&error_description=private",
		"state=" + state + "&error=access_denied&code=synthetic-code",
		"state=" + state + "&error=access_denied&realmId=1",
		"state=" + state + "&error=access_denied&state=" + state,
		"%73tate=" + state + "&error=access_denied",
		"state=" + state + "&error=access_denied#fragment",
		"state=" + state + "&error=%zz",
		"state=" + state + "%0D%0A&error=access_denied",
		"state=x1_" + strings.Repeat("a", 43) + "&error=access_denied",
		"state=" + validStateFixture + "&error=access_denied",
		"state=" + strings.Repeat("a", MaxRawQueryBytes) + "&error=access_denied",
	} {
		if _, err := ParseForwardedCallback("GET", CallbackPath, query, true); err == nil {
			t.Fatal("malformed denial must fail closed")
		}
	}
	query := "state=" + state + "&error=access_denied"
	for _, input := range []struct {
		method, path, query string
		end                 bool
	}{
		{"POST", CallbackPath, query, true}, {"GET", CallbackPath, query, false},
		{"GET", "/other", query, true}, {"GET", CallbackPath + "?other=1", query, true},
	} {
		if _, err := ParseForwardedCallback(input.method, input.path, input.query, input.end); err == nil {
			t.Fatal("noncanonical denial request must fail closed")
		}
	}
}

func TestDenialDoesNotRelaxSuccessfulThreeFieldCallback(t *testing.T) {
	query := "state=i1_" + strings.Repeat("a", 43) + "&code=synthetic-code&realmId=1"
	handoff, err := ParseForwardedCallback("GET", CallbackPath, query, true)
	if err != nil || handoff.Denied || handoff.Code != "synthetic-code" || handoff.RealmID != "1" {
		t.Fatal("successful callback contract changed")
	}
	for _, extra := range []string{"&error=access_denied", "&scope=accounting", "&code=another-code"} {
		if _, err := ParseForwardedCallback("GET", CallbackPath, query+extra, true); err == nil {
			t.Fatal("successful callback must still have exactly its three fields")
		}
	}
}
