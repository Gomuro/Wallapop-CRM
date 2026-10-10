export const THEME_COOKIE = "theme"
export const THEME_STORAGE_KEY = "theme"

/** Runs before paint so the first frame matches storage / cookie / system. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(!t){var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(dark|light)/);t=m?m[1]:null}var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}`

export function persistTheme(dark: boolean) {
  const value = dark ? "dark" : "light"
  document.documentElement.classList.toggle("dark", dark)
  localStorage.setItem(THEME_STORAGE_KEY, value)
  document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax`
}
