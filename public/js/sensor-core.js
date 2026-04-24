import { app } from '../firebase-config.js';
import {
    getFirestore,
    collection,
    query,
    orderBy,
    limit,
    getDocs,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

const db = getFirestore(app);

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------
const DB_CONFIG = {
    collection: 'dataCollectionSensor',
    fields: {
        temp: 'temperature',
        hum: 'humidity',
        soil: 'avgSoilMoisture',
        time: 'timestamp'
    }
};

const THRESHOLDS = {
    soil: {
        optimal: { min: 25, max: 45 },
        warning: { min: 20, max: 50 },
        critical: { min: 15, max: 55 }
    },
    temp: {
        optimal: { min: 22, max: 30 },
        warning: { min: 18, max: 33 },
        critical: { min: 15, max: 36 }
    },
    hum: {
        optimal: { min: 60, max: 80 },
        warning: { min: 50, max: 85 },
        critical: { min: 40, max: 90 }
    }
};

// ------------------------------------------------------------------
// DATA SERVICE
// ------------------------------------------------------------------
class DataService {
    constructor() {
        this.collectionRef = collection(db, DB_CONFIG.collection);
    }

    listenToLatest(callback) {
        const q = query(
            this.collectionRef,
            orderBy(DB_CONFIG.fields.time, 'desc'),
            limit(1)
        );

        return onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                callback(snapshot.docs[0].data());
            }
        });
    }

    async fetchHistory(timeframe) {
        const now = new Date();
        let interval = 'hour';
        let startTime, endTime;

        switch (timeframe) {
            case 'weeks':
                startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                endTime = now;
                interval = 'day';
                break;

            case 'months':
                startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                endTime = now;
                interval = 'day';
                break;

            case 'days':
            default:
                startTime = new Date(now);
                startTime.setHours(8, 0, 0, 0);
                endTime = new Date(now);
                endTime.setHours(20, 50, 0, 0);
                interval = 'hour';
        }

        const q = query(
            this.collectionRef,
            orderBy(DB_CONFIG.fields.time, 'asc')
        );

        try {
            const snapshot = await getDocs(q);

            const rawData = snapshot.docs
                .map(doc => {
                    const data = doc.data();
                    const parsedTime = new Date(data[DB_CONFIG.fields.time]);

                    if (isNaN(parsedTime)) return null;

                    return {
                        temp: data[DB_CONFIG.fields.temp],
                        hum: data[DB_CONFIG.fields.hum],
                        soil: data[DB_CONFIG.fields.soil],
                        time: parsedTime
                    };
                })
                .filter(d => d && d.time >= startTime && d.time <= endTime);

            const timeline = [];
            const dataMap = new Map();
            let cursor = new Date(startTime);

            while (cursor <= endTime) {
                let label;

                if (interval === 'hour') {
                    label = cursor.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    cursor.setMinutes(cursor.getMinutes() + 10);
                } else {
                    label = cursor.toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric'
                    });
                    cursor.setDate(cursor.getDate() + 1);
                }

                timeline.push(label);
                dataMap.set(label, { temp: null, hum: null, soil: null });
            }

            rawData.forEach(d => {
                const label =
                    interval === 'hour'
                        ? d.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : d.time.toLocaleDateString([], { month: 'short', day: 'numeric' });

                if (dataMap.has(label)) {
                    dataMap.set(label, {
                        temp: d.temp,
                        hum: d.hum,
                        soil: d.soil
                    });
                }
            });

            return timeline.map(label => ({
                label,
                ...dataMap.get(label)
            }));

        } catch (err) {
            console.error("Error fetching history:", err);
            return [];
        }
    }
}

// ------------------------------------------------------------------
// CHART CONTROLLER
// ------------------------------------------------------------------
class ChartController {
    constructor(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        this.ctx = canvas.getContext('2d');
        this.chart = null;
    }

    render(data) {
        if (!this.ctx) return;

        const chartData = {
            labels: data.map(d => d.label),
            datasets: [
                {
                    label: 'Temperature (°C)',
                    data: data.map(d => d.temp),
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    yAxisID: 'yTemp'
                },
                {
                    label: 'Soil Moisture (%)',
                    data: data.map(d => d.soil),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    yAxisID: 'yPct'
                },
                {
                    label: 'Humidity (%)',
                    data: data.map(d => d.hum),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    tension: 0.10,
                    yAxisID: 'yPct'
                }
            ]
        };

        if (this.chart) {
            this.chart.data = chartData;
            this.chart.update();
        } else {
            this.chart = new Chart(this.ctx, {
                type: 'line',
                data: chartData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 20 } }
                    },
                    scales: {
                        x: {
                            ticks: { maxTicksLimit: 7, maxRotation: 0, autoSkip: true },
                            grid: { display: false }
                        },
                        yPct: {
                            type: 'linear', display: true, position: 'left',
                            title: { display: true, text: 'Percentage (%)' },
                            min: 0, max: 100
                        },
                        yTemp: {
                            type: 'linear', display: true, position: 'right',
                            title: { display: true, text: 'Temperature (°C)' },
                            grid: { drawOnChartArea: false }
                        }
                    }
                }
            });
        }
    }
}

// ------------------------------------------------------------------
// SENSOR DASHBOARD BASE CLASS
// ------------------------------------------------------------------
class SensorDashboardBase {
    constructor(cachePrefix = 'calamansi') {
        this.SENSOR_CACHE_KEY = `${cachePrefix}_latest_sensors`;
        this.CHART_CACHE_KEY = `${cachePrefix}_chart_cache`;
        this.dataService = new DataService();
        this.chartController = new ChartController('sensorChart');
        this.latestReadings = null;

        this.ui = {
            temp: document.getElementById('sensor-temp'),
            hum: document.getElementById('sensor-hum'),
            soil: document.getElementById('sensor-soil')
        };

        this.aiUi = {
            status: document.getElementById('ai-main-status'),
            desc: document.getElementById('ai-main-desc'),
            yield: document.getElementById('ai-yield-impact'),
            fert: document.getElementById('ai-fert-schedule'),
            btnAsk: document.getElementById('btn-ask-ai'),
            responseBox: document.getElementById('ai-response-box')
        };
    }

    loadSensorsFromCache() {
        const cached = localStorage.getItem(this.SENSOR_CACHE_KEY);
        if (cached) {
            const data = JSON.parse(cached);
            this.updateCardsAndAI(data, true);
        }

        const cachedChart = localStorage.getItem(this.CHART_CACHE_KEY);
        if (cachedChart) {
            this.chartController.render(JSON.parse(cachedChart));
        }
    }

    init() {
        this.initEventListeners();

        this.dataService.listenToLatest((data) => {
            this.latestReadings = data;
            localStorage.setItem(this.SENSOR_CACHE_KEY, JSON.stringify(data));
            this.updateCardsAndAI(data);
        });

        this.updateChart('days');
    }

    initEventListeners() {
        const timeButtons = document.querySelectorAll('#timeframe-controls button[data-tf]');
        timeButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                timeButtons.forEach(b => {
                    b.classList.remove('chart-filter-active', 'shadow-sm', 'shadow-lime-200');
                    b.classList.add('chart-filter-inactive');
                });
                e.target.classList.remove('chart-filter-inactive');
                e.target.classList.add('chart-filter-active', 'shadow-sm', 'shadow-lime-200');
                this.updateChart(e.target.dataset.tf);
            });
        });

        if (this.aiUi.btnAsk) {
            this.aiUi.btnAsk.addEventListener('click', () => {
                this.showDetailedRecommendations();
            });
        }
    }

    async updateChart(timeframe) {
        const historyData = await this.dataService.fetchHistory(timeframe);
        if (historyData.length > 0) {
            localStorage.setItem(this.CHART_CACHE_KEY, JSON.stringify(historyData));
            this.chartController.render(historyData);
        }
    }

    updateCardsAndAI(data, isCached = false) {
        if (!data) return;
        if (this.ui.temp) this.ui.temp.innerText = `${data[DB_CONFIG.fields.temp] ?? '--'}°C`;
        if (this.ui.hum) this.ui.hum.innerText = `${data[DB_CONFIG.fields.hum] ?? '--'}%`;
        if (this.ui.soil) this.ui.soil.innerText = `${data[DB_CONFIG.fields.soil] ?? '--'}%`;

        if (this.ui.temp) this.ui.temp.style.opacity = isCached ? "0.6" : "1";

        this.runRuleBasedAnalysis(data);
    }

    runRuleBasedAnalysis(data) {
        const soilVal = data[DB_CONFIG.fields.soil];
        const tempVal = data[DB_CONFIG.fields.temp];
        const humVal = data[DB_CONFIG.fields.hum];

        if (soilVal == null || tempVal == null || humVal == null || !this.aiUi.status) return;

        const conditions = this.analyzeAllConditions(soilVal, tempVal, humVal);
        this.updateAIUI(conditions);
    }

    analyzeAllConditions(soil, temp, humidity) {
        const conditions = {
            soil: this.analyzeSoil(soil),
            temperature: this.analyzeTemperature(temp),
            humidity: this.analyzeHumidity(humidity)
        };

        const criticalIssues = Object.values(conditions).filter(c => c.level === 'critical').length;
        const warningIssues = Object.values(conditions).filter(c => c.level === 'warning').length;

        if (criticalIssues > 0) {
            conditions.overall = { level: 'critical', message: 'Immediate Action Required' };
        } else if (warningIssues > 1) {
            conditions.overall = { level: 'warning', message: 'Monitor Conditions Closely' };
        } else if (warningIssues === 1) {
            conditions.overall = { level: 'warning', message: 'Minor Adjustments Needed' };
        } else {
            conditions.overall = { level: 'optimal', message: 'Optimal Growing Conditions' };
        }

        return conditions;
    }

    analyzeSoil(value) {
        if (value < THRESHOLDS.soil.critical.min || value > THRESHOLDS.soil.critical.max) {
            return {
                level: 'critical',
                message: `Critical soil moisture: ${value}%`,
                recommendation: value < THRESHOLDS.soil.critical.min ?
                    'IRRIGATE IMMEDIATELY - Risk of plant stress and fruit drop' :
                    'Reduce watering - Risk of root rot'
            };
        } else if (value < THRESHOLDS.soil.warning.min || value > THRESHOLDS.soil.warning.max) {
            return {
                level: 'warning',
                message: `Suboptimal soil moisture: ${value}%`,
                recommendation: value < THRESHOLDS.soil.warning.min ?
                    'Increase irrigation schedule' :
                    'Allow soil to dry slightly before next watering'
            };
        } else if (value >= THRESHOLDS.soil.optimal.min && value <= THRESHOLDS.soil.optimal.max) {
            return {
                level: 'optimal',
                message: `Ideal soil moisture: ${value}%`,
                recommendation: 'Maintain current watering schedule'
            };
        }
        return { level: 'warning', message: `Soil moisture: ${value}%`, recommendation: 'Monitor closely' };
    }

    analyzeTemperature(value) {
        if (value < THRESHOLDS.temp.critical.min || value > THRESHOLDS.temp.critical.max) {
            return {
                level: 'critical',
                message: `Critical temperature: ${value}°C`,
                recommendation: value < THRESHOLDS.temp.critical.min ?
                    'PROTECT FROM COLD - Cover plants or move to warmer area' :
                    'PROVIDE SHADE AND VENTILATION - Heat stress imminent'
            };
        } else if (value < THRESHOLDS.temp.warning.min || value > THRESHOLDS.temp.warning.max) {
            return {
                level: 'warning',
                message: `Non-optimal temperature: ${value}°C`,
                recommendation: value < THRESHOLDS.temp.warning.min ?
                    'Consider protective measures for cold-sensitive plants' :
                    'Ensure adequate air circulation and shading'
            };
        } else if (value >= THRESHOLDS.temp.optimal.min && value <= THRESHOLDS.temp.optimal.max) {
            return {
                level: 'optimal',
                message: `Ideal temperature: ${value}°C`,
                recommendation: 'Temperature conditions are perfect for growth'
            };
        }
        return { level: 'warning', message: `Temperature: ${value}°C`, recommendation: 'Monitor conditions' };
    }

    analyzeHumidity(value) {
        if (value < THRESHOLDS.hum.critical.min || value > THRESHOLDS.hum.critical.max) {
            return {
                level: 'critical',
                message: `Critical humidity: ${value}%`,
                recommendation: value < THRESHOLDS.hum.critical.min ?
                    'INCREASE HUMIDITY - Mist plants or use humidifier' :
                    'IMPROVE VENTILATION - High humidity promotes disease'
            };
        } else if (value < THRESHOLDS.hum.warning.min || value > THRESHOLDS.hum.warning.max) {
            return {
                level: 'warning',
                message: `Suboptimal humidity: ${value}%`,
                recommendation: value < THRESHOLDS.hum.warning.min ?
                    'Consider humidity increase for better fruit development' :
                    'Ensure good air circulation to prevent fungal issues'
            };
        } else if (value >= THRESHOLDS.hum.optimal.min && value <= THRESHOLDS.hum.optimal.max) {
            return {
                level: 'optimal',
                message: `Ideal humidity: ${value}%`,
                recommendation: 'Humidity levels support healthy fruit development'
            };
        }
        return { level: 'warning', message: `Humidity: ${value}%`, recommendation: 'Monitor humidity levels' };
    }

    updateAIUI(conditions) {
        const overall = conditions.overall;
        if (!this.aiUi.status) return;

        let icon, colorClass;

        switch (overall.level) {
            case 'critical':
                icon = 'fa-triangle-exclamation';
                colorClass = 'text-red-500';
                break;
            case 'warning':
                icon = 'fa-circle-exclamation';
                colorClass = 'text-amber-500';
                break;
            default:
                icon = 'fa-check-circle';
                colorClass = 'text-green-500';
        }

        this.aiUi.status.innerHTML = `<i class="fa-solid ${icon} ${colorClass} mr-2"></i>${overall.message}`;
        if (this.aiUi.desc) this.aiUi.desc.innerHTML = this.generateConditionSummary(conditions);
        if (this.aiUi.yield) this.aiUi.yield.innerText = this.calculateYieldImpact(conditions);
        if (this.aiUi.fert) this.aiUi.fert.innerText = this.getFertilizerAdvice(conditions);
    }

    generateConditionSummary(conditions) {
        const issues = [];
        Object.entries(conditions).forEach(([key, condition]) => {
            if (key !== 'overall' && condition.level !== 'optimal') {
                issues.push(condition.message);
            }
        });

        if (issues.length === 0) {
            return 'All sensors reporting optimal conditions for maximum yield.';
        } else if (issues.length === 1) {
            return `Attention needed: ${issues[0]}.`;
        } else {
            return `Multiple factors need attention: ${issues.join(', ')}.`;
        }
    }

    calculateYieldImpact(conditions) {
        const criticalCount = Object.values(conditions).filter(c => c.level === 'critical').length - 1;
        const warningCount = Object.values(conditions).filter(c => c.level === 'warning').length - 1;

        if (criticalCount > 0) {
            const impact = Math.min(30, criticalCount * 15);
            return `Yield risk: HIGH (-${impact}%) - Immediate intervention required`;
        } else if (warningCount > 0) {
            const impact = Math.min(15, warningCount * 5);
            return `Yield caution: Moderate (-${impact}%) - Monitor and adjust`;
        } else {
            return 'Yield potential: EXCELLENT (+5-10%) - Conditions are ideal';
        }
    }

    getFertilizerAdvice(conditions) {
        const criticalConditions = Object.values(conditions).filter(c => c.level === 'critical');

        if (criticalConditions.length > 0) {
            return 'POSTPONE FERTILIZATION - Address critical conditions first';
        } else {
            return 'FERTILIZATION SAFE - Follow regular nutrient schedule';
        }
    }

    showDetailedRecommendations() {
        if (!this.latestReadings) {
            alert("Waiting for sensor data connection...");
            return;
        }

        const box = this.aiUi.responseBox;
        const btn = this.aiUi.btnAsk;

        if (!box) return;

        box.classList.remove('hidden');
        box.classList.remove('border-indigo-200', 'bg-indigo-50');
        box.classList.add('border-lime-200', 'bg-lime-50');

        const soilVal = this.latestReadings[DB_CONFIG.fields.soil];
        const tempVal = this.latestReadings[DB_CONFIG.fields.temp];
        const humVal = this.latestReadings[DB_CONFIG.fields.hum];

        const conditions = this.analyzeAllConditions(soilVal, tempVal, humVal);
        const recommendations = this.generateDetailedRecommendations(conditions);

        box.innerHTML = `
            <div class="font-bold text-lime-800 mb-2">📋 Detailed Farming Recommendations</div>
            <div class="space-y-2 text-sm">
                ${recommendations.map(rec => `
                    <div class="flex items-start gap-2">
                        <i class="fa-solid ${rec.icon} ${rec.color} mt-1 flex-shrink-0"></i>
                        <div>
                            <div class="font-medium">${rec.title}</div>
                            <div class="text-slate-600">${rec.description}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="mt-3 pt-2 border-t border-lime-100 text-xs text-slate-500">
                Generated by Agronomic Analysis • ${new Date().toLocaleString()}
            </div>
        `;

        if (btn) btn.disabled = false;
    }

    generateDetailedRecommendations(conditions) {
        const recommendations = [];

        if (conditions.soil.level !== 'optimal') {
            recommendations.push({
                icon: conditions.soil.level === 'critical' ? 'fa-triangle-exclamation' : 'fa-circle-info',
                color: conditions.soil.level === 'critical' ? 'text-red-500' : 'text-amber-500',
                title: 'Soil Management',
                description: conditions.soil.recommendation
            });
        }

        if (conditions.temperature.level !== 'optimal') {
            recommendations.push({
                icon: conditions.temperature.level === 'critical' ? 'fa-triangle-exclamation' : 'fa-circle-info',
                color: conditions.temperature.level === 'critical' ? 'text-red-500' : 'text-amber-500',
                title: 'Temperature Control',
                description: conditions.temperature.recommendation
            });
        }

        if (conditions.humidity.level !== 'optimal') {
            recommendations.push({
                icon: conditions.humidity.level === 'critical' ? 'fa-triangle-exclamation' : 'fa-circle-info',
                color: conditions.humidity.level === 'critical' ? 'text-red-500' : 'text-amber-500',
                title: 'Humidity Management',
                description: conditions.humidity.recommendation
            });
        }

        recommendations.push({
            icon: 'fa-shield-alt',
            color: 'text-purple-500',
            title: 'Preventive Care',
            description: 'Inspect leaves for signs of stress, ensure proper drainage, and maintain clean growing environment.'
        });

        return recommendations;
    }
}

export { SensorDashboardBase, DataService, ChartController };
