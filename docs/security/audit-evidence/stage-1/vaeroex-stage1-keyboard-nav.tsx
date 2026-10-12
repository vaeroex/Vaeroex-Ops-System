const query = new URLSearchParams();
const router = { replace() {}, push() {} };
export const useRouter = () => router;
export const usePathname = () => '/audit';
export const useSearchParams = () => query;
