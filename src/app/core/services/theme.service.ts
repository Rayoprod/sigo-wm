import { Injectable, Inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private _isDarkMode = false;
  private readonly THEME_KEY = 'app_theme_preference';

  constructor(@Inject(DOCUMENT) private document: Document) {
    this.initTheme();
  }

  get isDarkMode(): boolean {
    return this._isDarkMode;
  }

  initTheme() {
    const savedTheme = localStorage.getItem(this.THEME_KEY);
    if (savedTheme === 'dark') {
      this._isDarkMode = true;
    } else if (savedTheme === 'light') {
      this._isDarkMode = false;
    } else {
      // Check system preference
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      this._isDarkMode = prefersDark;
    }
    this.applyTheme(this._isDarkMode);
  }

  toggleTheme() {
    this._isDarkMode = !this._isDarkMode;
    localStorage.setItem(this.THEME_KEY, this._isDarkMode ? 'dark' : 'light');
    this.applyTheme(this._isDarkMode);
  }

  private applyTheme(isDark: boolean) {
    // 1. Swap PrimeNG Theme via <link id="app-theme">
    const themeLink = this.document.getElementById('app-theme') as HTMLLinkElement;
    if (themeLink) {
      themeLink.href = isDark ? 'assets/themes/lara-dark-teal/theme.css' : 'assets/themes/lara-light-teal/theme.css';
    }

    // 2. Toggle global body class for PrimeFlex / custom CSS
    if (isDark) {
      this.document.body.classList.add('dark-mode');
    } else {
      this.document.body.classList.remove('dark-mode');
    }
  }
}
