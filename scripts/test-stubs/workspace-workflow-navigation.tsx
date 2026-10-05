const query = new URLSearchParams(window.location.search);
const router = { replace(path: string) { window.history.replaceState(null, "", path); }, push(path: string) { window.history.pushState(null, "", path); } };
export const useRouter = () => router;
export const usePathname = () => "/audit";
export const useSearchParams = () => query;
