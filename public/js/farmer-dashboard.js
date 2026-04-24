import { app } from '../firebase-config.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { SensorDashboardBase } from './sensor-core.js';

// ------------------------------------------------------------------
// WEATHER CONFIGURATION
// ------------------------------------------------------------------
const WEATHER_CACHE_KEY = 'calamansi_weather_cache';
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const FUNCTIONS_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:5001/calamansisys/us-central1'
    : 'https://us-central1-calamansisys.cloudfunctions.net';

const DEFAULT_LOCATION_KEY = '264885'; // Manila, PH - fallback

const WEATHER_ICON_MAP = {
    1: '☀️', 2: '🌤️', 3: '⛅', 4: '☁️', 5: '☁️',
    6: '🌫️', 7: '☁️', 8: '☁️', 11: '🌫️',
    12: '🌧️', 13: '🌦️', 14: '🌦️', 15: '⛈️',
    16: '⛈️', 17: '🌦️', 18: '🌧️', 19: '🌨️',
    20: '🌨️', 21: '🌨️', 22: '🌨️', 23: '🌨️',
    24: '❄️', 25: '❄️', 26: '❄️', 29: '🌧️',
    30: '🥵', 31: '🥶', 32: '💨'
};

// ------------------------------------------------------------------
// WEATHER SERVICE
// ------------------------------------------------------------------
class WeatherService {
    constructor() {
        this.locationKey = null;
    }

    async getLocationKey(userId) {
        try {
            const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js");
            const { app } = await import('../firebase-config.js');
            const db = getFirestore(app);
            const userDoc = await getDoc(doc(db, "users", userId));
            if (userDoc.exists()) {
                const data = userDoc.data();
                return data.weatherLocationKey || DEFAULT_LOCATION_KEY;
            }
        } catch (e) {
            console.warn("Could not fetch user location key:", e);
        }
        return DEFAULT_LOCATION_KEY;
    }

    async fetchRecommendations(locationKey) {
        const response = await fetch(`${FUNCTIONS_BASE_URL}/getRecommendations?locationKey=${locationKey}`);
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `HTTP ${response.status}`);
        }
        return response.json();
    }

    getCachedWeather() {
        try {
            const cached = localStorage.getItem(WEATHER_CACHE_KEY);
            if (!cached) return null;
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.cachedAt > WEATHER_CACHE_TTL_MS) return null;
            return parsed.data;
        } catch {
            return null;
        }
    }

    setCachedWeather(data) {
        try {
            localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
                cachedAt: Date.now(),
                data
            }));
        } catch (e) {
            console.warn("Could not cache weather:", e);
        }
    }

    getIconEmoji(iconCode) {
        return WEATHER_ICON_MAP[iconCode] || '🌡️';
    }
}

// ------------------------------------------------------------------
// FARMER DASHBOARD APP
// ------------------------------------------------------------------
class FarmerDashboardApp extends SensorDashboardBase {
    constructor() {
        super('calamansi_farmer');
        this.weatherService = new WeatherService();
        this.init();
    }

    init() {
        super.init();
        this.loadWeatherAndRecommendations();
    }

    async loadWeatherAndRecommendations() {
        const loadingEl = document.getElementById('weather-loading');
        const sourceEl = document.getElementById('weather-source');
        const container = document.getElementById('recommendations-container');

        try {
            let result = this.weatherService.getCachedWeather();
            let fromCache = !!result;

            if (!result) {
                let locationKey = DEFAULT_LOCATION_KEY;
                try {
                    const user = getAuth(app).currentUser;
                    if (user) {
                        locationKey = await this.weatherService.getLocationKey(user.uid);
                    }
                } catch (e) {
                    console.warn("Auth not ready, using default location:", e);
                }

                result = await this.weatherService.fetchRecommendations(locationKey);
                this.weatherService.setCachedWeather(result);
            }

            if (loadingEl) loadingEl.classList.add('hidden');
            if (sourceEl) {
                sourceEl.classList.remove('hidden');
                sourceEl.textContent = fromCache ? 'Cached' : (result.weatherSource === 'cache' ? 'Live (cached)' : 'Live');
            }

            this.renderWeatherMetrics(result.metrics);
            this.renderRecommendations(result.recommendations);

        } catch (error) {
            console.error("Weather load failed:", error);
            if (loadingEl) {
                loadingEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-500 mr-1"></i>Weather unavailable`;
            }
            if (container) {
                container.innerHTML = `
                    <div class="text-center py-6 text-slate-400 bg-slate-50 rounded-xl border border-slate-100">
                        <i class="fa-solid fa-cloud-slash text-2xl mb-2"></i>
                        <p class="text-sm">Could not load weather data. <button onclick="location.reload()" class="text-lime-600 hover:underline">Retry</button></p>
                    </div>
                `;
            }
        }
    }

    renderWeatherMetrics(metrics) {
        if (!metrics) return;

        const iconEl = document.getElementById('weather-icon');
        const tempEl = document.getElementById('weather-temp');
        const descEl = document.getElementById('weather-desc');
        const humEl = document.getElementById('weather-humidity');
        const windEl = document.getElementById('weather-wind');
        const uvEl = document.getElementById('weather-uv');
        const uvTextEl = document.getElementById('weather-uv-text');
        const visEl = document.getElementById('weather-visibility');

        if (iconEl) iconEl.textContent = this.weatherService.getIconEmoji(metrics.weatherIcon);
        if (tempEl) tempEl.textContent = `${metrics.temperatureC ?? '--'}°C`;
        if (descEl) descEl.textContent = metrics.weatherText || '--';
        if (humEl) humEl.textContent = `${metrics.relativeHumidity ?? '--'}%`;
        if (windEl) windEl.textContent = metrics.windSpeedKmh ?? '--';
        if (uvEl) uvEl.textContent = metrics.uvIndex ?? '--';
        if (uvTextEl) uvTextEl.textContent = metrics.uvIndexText || 'UV Index';
        if (visEl) visEl.textContent = metrics.visibilityKm ?? '--';
    }

    renderRecommendations(recommendations) {
        const container = document.getElementById('recommendations-container');
        if (!container) return;

        if (!recommendations || recommendations.length === 0) {
            container.innerHTML = `
                <div class="text-center py-6 text-slate-400 bg-slate-50 rounded-xl border border-slate-100">
                    <i class="fa-solid fa-check-circle text-green-500 text-2xl mb-2"></i>
                    <p class="text-sm">No weather alerts. Conditions are favorable.</p>
                </div>
            `;
            return;
        }

        const priorityColors = {
            high: { border: 'border-red-200', bg: 'bg-red-50', icon: 'text-red-500', badge: 'bg-red-100 text-red-700' },
            medium: { border: 'border-amber-200', bg: 'bg-amber-50', icon: 'text-amber-500', badge: 'bg-amber-100 text-amber-700' },
            low: { border: 'border-green-200', bg: 'bg-green-50', icon: 'text-green-500', badge: 'bg-green-100 text-green-700' }
        };

        const iconMap = {
            'temperature-high': 'fa-temperature-high',
            'sun': 'fa-sun',
            'bacterium': 'fa-bacterium',
            'droplet': 'fa-droplet',
            'wind': 'fa-wind',
            'basket': 'fa-basket-shopping',
            'snowflake': 'fa-snowflake',
            'cloud-rain': 'fa-cloud-rain',
            'default': 'fa-circle-exclamation'
        };

        container.innerHTML = recommendations.map(rec => {
            const colors = priorityColors[rec.priority] || priorityColors.medium;
            const iconClass = iconMap[rec.icon] || iconMap.default;
            return `
                <div class="flex items-start gap-4 p-4 rounded-xl border ${colors.border} ${colors.bg}">
                    <div class="w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
                        <i class="fa-solid ${iconClass} ${colors.icon} text-lg"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <h4 class="font-semibold text-slate-800 text-sm">${rec.name}</h4>
                            <span class="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${colors.badge}">${rec.priority}</span>
                        </div>
                        <p class="text-sm text-slate-600 leading-relaxed">${rec.action}</p>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// ------------------------------------------------------------------
// INITIALIZATION
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    new FarmerDashboardApp();

    // Sidebar toggle
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarClose = document.getElementById('sidebar-close');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');

    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.remove('-translate-x-full');
            sidebarBackdrop.classList.remove('hidden');
        });
    }

    if (sidebarClose) {
        sidebarClose.addEventListener('click', () => {
            sidebar.classList.add('-translate-x-full');
            sidebarBackdrop.classList.add('hidden');
        });
    }

    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', () => {
            sidebar.classList.add('-translate-x-full');
            sidebarBackdrop.classList.add('hidden');
        });
    }
});

export { FarmerDashboardApp };
