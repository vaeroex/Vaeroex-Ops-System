export const SQUARE_PRODUCTION_HOST: "square.vaeroex.com";
export const SQUARE_CALLBACK_PATH: "/api/integrations/square/callback";
export function parseSquareProductionCallbackHandoff(input: {
  method: string; url: string; rawHeaders: string[];
}): Readonly<{ kind: "authorized"; state: string; authorizationCode: string }> |
  Readonly<{ kind: "denied"; state: string; authorizationCode: null }>;
