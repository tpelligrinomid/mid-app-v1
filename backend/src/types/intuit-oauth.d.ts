declare module 'intuit-oauth' {
  interface OAuthClientConfig {
    clientId: string;
    clientSecret: string;
    environment: 'sandbox' | 'production';
    redirectUri: string;
  }

  interface AuthorizeUriOptions {
    scope: string[];
    state?: string;
  }

  interface TokenResponse {
    getJson(): {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
      x_refresh_token_expires_in: number;
      realmId: string;
    };
  }

  interface SetTokenOptions {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    realmId: string;
  }

  class OAuthClient {
    static scopes: {
      Accounting: string;
      Payment: string;
      Payroll: string;
      TimeTracking: string;
      Benefits: string;
      Profile: string;
      Email: string;
      Phone: string;
      Address: string;
      OpenId: string;
    };

    constructor(config: OAuthClientConfig);

    authorizeUri(options: AuthorizeUriOptions): string;
    createToken(url: string): Promise<TokenResponse>;
    refresh(): Promise<TokenResponse>;
    setToken(token: SetTokenOptions): void;
    getToken(): SetTokenOptions;
    isAccessTokenValid(): boolean;
    isRefreshTokenValid(): boolean;
  }

  export = OAuthClient;
}
