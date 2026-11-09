import { afterEach, describe, expect, it, vi } from 'vitest';
import { webOrigins } from '../src/modules/auth/web-origins';
describe('local cookie/CORS origins',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('allows the other loopback hostname only on the configured port in development',()=>{vi.stubEnv('NODE_ENV','development');vi.stubEnv('WEB_ORIGIN','http://localhost:5173');expect(webOrigins()).toEqual(['http://localhost:5173','http://127.0.0.1:5173']);expect(webOrigins()).not.toContain('http://127.0.0.1:9999')});
 it('does not broaden production or arbitrary remote origins',()=>{vi.stubEnv('NODE_ENV','production');vi.stubEnv('WEB_ORIGIN','http://localhost:5173, https://gloomi.example');expect(webOrigins()).toEqual(['http://localhost:5173','https://gloomi.example']);vi.stubEnv('NODE_ENV','development');vi.stubEnv('WEB_ORIGIN','https://gloomi.example');expect(webOrigins()).toEqual(['https://gloomi.example'])});
});
