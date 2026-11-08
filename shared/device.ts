import type { DisplayDrawParams } from '@busy-app/busy-lib';

/** Small on-device client: avoids browser/Node transport machinery in the 128 KiB heap. */
async function request(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`http://${__BUSY_ADDR__}/api/${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Device HTTP ${response.status}`);
  return response.json();
}
export const device = {
  DisplayDraw: (body: DisplayDrawParams) => request('display/draw', body),
  AppsSettingsGet: (params: { app_id: string }) => request(`apps/settings?app_id=${encodeURIComponent(params.app_id)}`) as Promise<{ version: number; values: Record<string, unknown> }>,
  WifiStatusGet: () => request('wifi/status') as Promise<{ state: string }>,
};
