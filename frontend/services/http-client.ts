import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";

const DEFAULT_TIMEOUT_MS = 30_000;

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

const axiosInstance: AxiosInstance = axios.create({
  baseURL,
  timeout: DEFAULT_TIMEOUT_MS,

  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      const next = encodeURIComponent(window.location.pathname);
      window.location.assign(`/login?next=${next}`);
    }

    return Promise.reject(error);
  },
);

export class HttpClient {
  static async get<TResponse>(url: string, config?: AxiosRequestConfig): Promise<TResponse> {
    const response = await axiosInstance.get<TResponse>(url, config);
    return response.data;
  }

  static async post<TResponse, TBody = unknown>(
    url: string,
    body?: TBody,
    config?: AxiosRequestConfig,
  ): Promise<TResponse> {
    const response = await axiosInstance.post<TResponse>(url, body, config);
    return response.data;
  }

  static async put<TResponse, TBody = unknown>(
    url: string,
    body?: TBody,
    config?: AxiosRequestConfig,
  ): Promise<TResponse> {
    const response = await axiosInstance.put<TResponse>(url, body, config);
    return response.data;
  }

  static async patch<TResponse, TBody = unknown>(
    url: string,
    body?: TBody,
    config?: AxiosRequestConfig,
  ): Promise<TResponse> {
    const response = await axiosInstance.patch<TResponse>(url, body, config);
    return response.data;
  }

  static async delete<TResponse>(url: string, config?: AxiosRequestConfig): Promise<TResponse> {
    const response = await axiosInstance.delete<TResponse>(url, config);
    return response.data;
  }
}

export { axiosInstance };
