import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export const API_BASE = '/api';

type Params = Record<string, string | number | boolean | null | undefined>;

function toParams(params?: Params): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
  }
  return p;
}

export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server. Check your connection.';
    const body = err.error;
    if (body && typeof body === 'object' && 'message' in body) return String(body.message);
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  get<T>(path: string, params?: Params): Promise<T> {
    return firstValueFrom(this.http.get<T>(API_BASE + path, { params: toParams(params) }));
  }
  post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(API_BASE + path, body));
  }
  patch<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.patch<T>(API_BASE + path, body));
  }
  put<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.put<T>(API_BASE + path, body));
  }
  delete<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(API_BASE + path));
  }

  /** Download an authenticated file (report export / supporting document). */
  async download(path: string, params?: Params, fallbackName = 'download'): Promise<void> {
    const res = await firstValueFrom(
      this.http.get(API_BASE + path, { params: toParams(params), responseType: 'blob', observe: 'response' })
    );
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const url = URL.createObjectURL(res.body as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = match ? match[1] : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
