/** Base URL for deep links into the MiD web app (changes with the New North domain move). */
export const APP_URL = (process.env.APP_URL ?? 'https://app.marketersindemand.com').replace(/\/+$/, '');
