'use client';

import { API_BASE_URL, ApiError, NetworkError } from '../api-client';
import { getAccessToken } from '../token-storage';

/**
 * Shared multipart-upload helper for every entity's `POST /{resource}/bulk-import`.
 * Mirrors useStudentMutations.ts's useBulkImportStudents() exactly: bypasses
 * apiFetch (which always JSON-encodes) since a multipart body needs the
 * browser to set its own boundary-bearing Content-Type.
 */
export async function uploadBulkImportFile(resourcePath: string, file: File): Promise<{ job_id: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const token = getAccessToken();

  let res: Response;
  try {
    res = await fetch(new URL(`/${resourcePath}/bulk-import`, API_BASE_URL).toString(), {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });
  } catch (err) {
    throw new NetworkError(err);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as { job_id: string };
}

/**
 * Shared template-download helper for every entity's
 * `GET /{resource}/bulk-import/template`. Runs in the real browser (not a
 * sandboxed artifact), so triggering a download via a temporary <a download>
 * click is safe here.
 */
export async function downloadBulkImportTemplate(resourcePath: string, filename: string): Promise<void> {
  const token = getAccessToken();
  let res: Response;
  try {
    res = await fetch(new URL(`/${resourcePath}/bulk-import/template`, API_BASE_URL).toString(), {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch (err) {
    throw new NetworkError(err);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
