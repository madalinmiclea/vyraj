const MAX_CONCURRENT = 6;
const MAX_RETRIES = 3;
const ERROR_FLOOR = 15;

let active = 0;
const queue: (() => void)[] = [];
let pausedUntil = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
}

function release() {
  const next = queue.shift();
  if (next) next();
  else active--;
}

function noteLimits(res: Response) {
  const remain = Number(res.headers.get('x-esi-error-limit-remain'));
  const reset = Number(res.headers.get('x-esi-error-limit-reset'));
  if (res.headers.has('x-esi-error-limit-remain') && remain < ERROR_FLOOR && reset > 0) pausedUntil = Math.max(pausedUntil, Date.now() + reset * 1000);
}

export async function esiFetch(input: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await sleep(wait);
    await acquire();
    let res: Response | null = null;
    let failure: unknown = null;
    try {
      res = await fetch(input, init);
    } catch (e) {
      failure = e;
    } finally {
      release();
    }
    if (res) noteLimits(res);
    const retryable = !res || res.status === 420 || res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    if (!retryable || attempt >= MAX_RETRIES) {
      if (res) return res;
      throw failure;
    }
    const after = Number(res?.headers.get('retry-after') || res?.headers.get('x-esi-error-limit-reset'));
    await sleep(after > 0 ? after * 1000 : 500 * 2 ** attempt);
  }
}
