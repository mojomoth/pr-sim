import Anthropic from '@anthropic-ai/sdk';
const c = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
try { const r = await c.messages.create({ model: 'claude-haiku-5-5', max_tokens: 20, messages: [{ role: 'user', content: 'hi' }] }); console.log('OK', r.stop_reason); } catch (e) { console.log('ERR', e.status, String(e.message).slice(0, 200)); }
