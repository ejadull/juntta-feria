import { BadGatewayException } from '@nestjs/common';
import { MercadoPagoOAuth } from './mercadopago-oauth.js';

const SETTINGS = {
  environment: 'sandbox' as const,
  clientId: '1234567890',
  clientSecret: 'fake-client-secret',
  oauthRedirectUri:
    'https://app.example.test/organizador/mercado-pago/vincular',
};

const TOKENS = {
  access_token: 'APP_USR-access',
  refresh_token: 'TG-refresh',
  expires_in: 15_552_000,
  user_id: 987654,
  live_mode: false,
  public_key: 'APP_USR-public',
  token_type: 'Bearer',
  scope: 'offline_access read write',
};

let sent: { url: string; body: Record<string, unknown> }[] = [];

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      sent.push({
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
}

afterEach(() => {
  sent = [];
  vi.unstubAllGlobals();
});

describe('MercadoPagoOAuth (PAY-07, ADR 0006 §2)', () => {
  const oauth = new MercadoPagoOAuth(SETTINGS);

  it('builds the authorization URL with PKCE S256 and the static redirect', () => {
    const url = new URL(oauth.authorizationUrl('the-state', 'the-challenge'));
    expect(url.origin + url.pathname).toBe(
      'https://auth.mercadopago.com/authorization',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '1234567890',
      response_type: 'code',
      platform_id: 'mp',
      redirect_uri: SETTINGS.oauthRedirectUri,
      state: 'the-state',
      code_challenge: 'the-challenge',
      code_challenge_method: 'S256',
    });
  });

  it('exchanges the code with its verifier for the seller tokens', async () => {
    respond(200, TOKENS);
    const tokens = await oauth.exchange('TG-code', 'the-verifier');

    expect(sent[0].url).toBe('https://api.mercadopago.com/oauth/token');
    expect(sent[0].body).toEqual({
      client_id: '1234567890',
      client_secret: 'fake-client-secret',
      grant_type: 'authorization_code',
      code: 'TG-code',
      code_verifier: 'the-verifier',
      redirect_uri: SETTINGS.oauthRedirectUri,
      test_token: true,
    });
    expect(tokens).toEqual({
      accessToken: 'APP_USR-access',
      refreshToken: 'TG-refresh',
      expiresInSeconds: 15_552_000,
      sellerId: '987654',
      liveMode: false,
    });
  });

  it('refreshes with the refresh token', async () => {
    respond(200, { ...TOKENS, refresh_token: 'TG-refresh-2' });
    const tokens = await oauth.refresh('TG-refresh');
    expect(sent[0].body).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'TG-refresh',
    });
    expect(tokens.refreshToken).toBe('TG-refresh-2');
  });

  it('maps a rejected or incomplete answer to a 502 without its body', async () => {
    respond(400, { error: 'invalid_grant', message: 'echo TG-code' });
    await expect(oauth.exchange('TG-code', 'v')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    respond(200, { token_type: 'Bearer' });
    await expect(oauth.refresh('TG-refresh')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
