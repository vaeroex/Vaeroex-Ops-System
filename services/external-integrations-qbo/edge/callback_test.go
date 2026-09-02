package callbackedge

import "testing"

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
