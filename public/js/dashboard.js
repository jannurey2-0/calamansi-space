import { app } from '../firebase-config.js'; // Removed the trailing space in path
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    query, 
    where, 
    orderBy, 
    limit, 
    getDocs, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { initAuthSidebar } from './Auth.js';
import mlModel from './ml-service.js';
import './data-generator.js'; // Import for global access
import './balanced-data-generator.js'; // Import for balanced data generation

const auth = getAuth(app);
const db = getFirestore(app);

// ------------------------------------------------------------------
// CONFIGURATION & CACHE KEYS
// ------------------------------------------------------------------
// Gemini API disabled - using rule-based recommendations
// const GEMINI_API_KEY = "AIzaSyC_KSNVkDoOJEdOQhirt7XBNVAwhbC4ppk"; 

const USER_CACHE_KEY = 'calamansi_user_profile';
const SENSOR_CACHE_KEY = 'calamansi_latest_sensors';
const CHART_CACHE_KEY = 'calamansi_chart_cache';

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

        // ✅ NO where() — string-safe
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

                    if (isNaN(parsedTime)) return null

                    return {
                        temp: data[DB_CONFIG.fields.temp],
                        hum: data[DB_CONFIG.fields.hum],
                        soil: data[DB_CONFIG.fields.soil],
                        time: parsedTime
                    };
                })
                .filter(d => d && d.time >= startTime && d.time <= endTime);

            // --------------------------------------------------
            // BUILD TIMELINE
            // --------------------------------------------------
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

            // --------------------------------------------------
            // MAP DATA TO TIMELINE
            // --------------------------------------------------
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
// MAIN APP & GEMINI LOGIC
// ------------------------------------------------------------------
class DashboardApp {
    constructor() {
        this.dataService = new DataService();
        this.chartController = new ChartController('sensorChart');
        
        this.latestReadings = null;

        const headings = document.querySelectorAll('h3');
        this.ui = {
            temp: headings[0],
            hum: headings[1],
            soil: headings[2],
            sidebarName: document.getElementById('user-display-name'),
            sidebarEmail: document.getElementById('user-display-email'),
            sidebarImg: document.getElementById('sidebar-avatar')
        };

        this.aiUi = {
            status: document.getElementById('ai-main-status'),
            desc: document.getElementById('ai-main-desc'),
            yield: document.getElementById('ai-yield-impact'),
            fert: document.getElementById('ai-fert-schedule'),
            btnAsk: document.getElementById('btn-ask-ai'),
            responseBox: document.getElementById('ai-response-box')
        };

        initAuthSidebar(); // Initialize sidebar profile listener
        this.initMLModel();
        this.setupMLTrainingUI();
        this.loadSensorsFromCache();
        this.init();
    }

    loadSensorsFromCache() {
        const cached = localStorage.getItem(SENSOR_CACHE_KEY);
        if (cached) {
            const data = JSON.parse(cached);
            this.updateCardsAndAI(data, true); 
        }
        
        const cachedChart = localStorage.getItem(CHART_CACHE_KEY);
        if (cachedChart) {
            this.chartController.render(JSON.parse(cachedChart));
        }
    }

    init() {
        this.initEventListeners();
        
        this.dataService.listenToLatest((data) => {
            this.latestReadings = data; 
            localStorage.setItem(SENSOR_CACHE_KEY, JSON.stringify(data)); 
            this.updateCardsAndAI(data);
        });

        this.updateChart('hours');
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
            this.aiUi.btnAsk.addEventListener('click', async () => {
                await this.showDetailedRecommendations();
            });
        }
    }

    async updateChart(timeframe) {
        const historyData = await this.dataService.fetchHistory(timeframe);
        if (historyData.length > 0) {
            localStorage.setItem(CHART_CACHE_KEY, JSON.stringify(historyData));
            this.chartController.render(historyData);
        }
    }

    updateCardsAndAI(data, isCached = false) {
        if (!data) return;
        this.ui.temp.innerText = `${data[DB_CONFIG.fields.temp] ?? '--'}°C`;
        this.ui.hum.innerText = `${data[DB_CONFIG.fields.hum] ?? '--'}%`;
        this.ui.soil.innerText = `${data[DB_CONFIG.fields.soil] ?? '--'}%`;
        
        this.ui.temp.style.opacity = isCached ? "0.6" : "1";

        this.runRuleBasedAnalysis(data);
    }

    async runRuleBasedAnalysis(data) {
        const soilVal = data[DB_CONFIG.fields.soil];
        const tempVal = data[DB_CONFIG.fields.temp];
        const humVal = data[DB_CONFIG.fields.hum];
        
        if (soilVal == null || tempVal == null || humVal == null || !this.aiUi.status) return;

        // Comprehensive condition assessment
        const conditions = this.analyzeAllConditions(soilVal, tempVal, humVal);
        
        // Run ML prediction first to get ML-based recommendations
        const mlPredictionSuccess = await this.runMLPrediction(data);
        
        // Only update with rule-based analysis if ML prediction failed
        if (!mlPredictionSuccess) {
            this.updateAIUI(conditions);
        }
    }

    analyzeAllConditions(soil, temp, humidity) {
        const conditions = {
            soil: this.analyzeSoil(soil),
            temperature: this.analyzeTemperature(temp),
            humidity: this.analyzeHumidity(humidity)
        };

        // Overall system status
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
        // Update main status
        const overall = conditions.overall;
        let icon, colorClass;
        
        switch(overall.level) {
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
        
        // Update description
        this.aiUi.desc.innerHTML = this.generateConditionSummary(conditions);
        
        // Update yield impact
        this.aiUi.yield.innerText = this.calculateYieldImpact(conditions);
        
        // Update fertilizer schedule
        this.aiUi.fert.innerText = this.getFertilizerAdvice(conditions);
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
        const criticalCount = Object.values(conditions).filter(c => c.level === 'critical').length - 1; // exclude overall
        const warningCount = Object.values(conditions).filter(c => c.level === 'warning').length - 1; // exclude overall
        
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

    async showDetailedRecommendations() {
        if (!this.latestReadings) {
            alert("Waiting for sensor data connection...");
            return;
        }

        const box = this.aiUi.responseBox;
        const btn = this.aiUi.btnAsk;
        
        box.classList.remove('hidden');
        box.classList.remove('border-indigo-200', 'bg-indigo-50');
        box.classList.add('border-lime-200', 'bg-lime-50');
        
        const soilVal = this.latestReadings[DB_CONFIG.fields.soil];
        const tempVal = this.latestReadings[DB_CONFIG.fields.temp];
        const humVal = this.latestReadings[DB_CONFIG.fields.hum];
        
        const conditions = this.analyzeAllConditions(soilVal, tempVal, humVal);
        
        try {
            // Use the async version to get recommendations with ML predictions
            const recommendations = await this.generateDetailedRecommendationsAsync(conditions);
            
            // Ensure recommendations is an array before mapping
            if (!Array.isArray(recommendations)) {
                console.error('generateDetailedRecommendationsAsync did not return an array:', recommendations);
                box.innerHTML = `
                    <div class="font-bold text-lime-800 mb-2">📋 Detailed Farming Recommendations</div>
                    <div class="text-sm text-red-600">Error: Unable to generate recommendations. Please try again.</div>
                `;
                return;
            }
            
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
                    Generated by Machine Learning Agronomic Analysis • ${new Date().toLocaleString()}
                </div>
            `;
        } catch (error) {
            console.error('Error generating recommendations:', error);
            box.innerHTML = `
                <div class="font-bold text-lime-800 mb-2">📋 Detailed Farming Recommendations</div>
                <div class="text-sm text-red-600">Error: ${error.message}</div>
            `;
        }
        
        btn.disabled = false;
    }

    generateDetailedRecommendations(conditions) {
        const recommendations = [];
        
        // Soil recommendations
        if (conditions.soil.level !== 'optimal') {
            recommendations.push({
                icon: conditions.soil.level === 'critical' ? 'fa-triangle-exclamation' : 'fa-circle-info',
                color: conditions.soil.level === 'critical' ? 'text-red-500' : 'text-amber-500',
                title: 'Soil Management',
                description: conditions.soil.recommendation
            });
        }
        
        // Temperature recommendations
        if (conditions.temperature.level !== 'optimal') {
            recommendations.push({
                icon: conditions.temperature.level === 'critical' ? 'fa-triangle-exclamation' : 'fa-circle-info',
                color: conditions.temperature.level === 'critical' ? 'text-red-500' : 'text-amber-500',
                title: 'Temperature Control',
                description: conditions.temperature.recommendation
            });
        }
        
        // Humidity recommendations
        if (conditions.humidity.level !== 'optimal') {
            recommendations.push({
                icon: conditions.humidity.level === 'critical' ? 'fa-triangle-exclamation' : 'fa-circle-info',
                color: conditions.humidity.level === 'critical' ? 'text-red-500' : 'text-amber-500',
                title: 'Humidity Management',
                description: conditions.humidity.recommendation
            });
        }
        
        // Growth Stage-Specific Recommendations
        const growthStageRecommendations = this.getGrowthStageRecommendations(conditions);
        recommendations.push(...growthStageRecommendations);
        
        // Fertilizer Recommendations based on conditions
        const fertilizerRecommendations = this.getFertilizerRecommendations(conditions);
        recommendations.push(...fertilizerRecommendations);
        
        // Seasonal Recommendations
        const seasonalRecommendations = this.getSeasonalRecommendations(conditions);
        recommendations.push(...seasonalRecommendations);
        
        // Preventive care
        recommendations.push({
            icon: 'fa-shield-alt',
            color: 'text-purple-500',
            title: 'Preventive Care',
            description: 'Inspect leaves for signs of stress, ensure proper drainage, and maintain clean growing environment.'
        });
        
        return recommendations;
    }
    
    // Async version for when ML prediction is needed
    async generateDetailedRecommendationsAsync(conditions) {
        const recommendations = [];
        
        // Soil recommendations
        if (conditions.soil.level !== 'optimal') {
            recommendations.push({
                icon: conditions.soil.level === 'critical' ? 'fa-triangle-exclamation' : 'fa-circle-info',
                color: conditions.soil.level === 'critical' ? 'text-red-500' : 'text-amber-500',
                title: 'Soil Management',
                description: conditions.soil.recommendation
            });
        }
        
        // Temperature recommendations
        if (conditions.temperature.level !== 'optimal') {
            recommendations.push({
                icon: conditions.temperature.level === 'critical' ? 'fa-triangle-exclamation' : 'fa-circle-info',
                color: conditions.temperature.level === 'critical' ? 'text-red-500' : 'text-amber-500',
                title: 'Temperature Control',
                description: conditions.temperature.recommendation
            });
        }
        
        // Humidity recommendations
        if (conditions.humidity.level !== 'optimal') {
            recommendations.push({
                icon: conditions.humidity.level === 'critical' ? 'fa-triangle-exclamation' : 'fa-circle-info',
                color: conditions.humidity.level === 'critical' ? 'text-red-500' : 'text-amber-500',
                title: 'Humidity Management',
                description: conditions.humidity.recommendation
            });
        }
        
        // Growth Stage-Specific Recommendations
        const growthStageRecommendations = this.getGrowthStageRecommendations(conditions);
        recommendations.push(...growthStageRecommendations);
        
        // Fertilizer Recommendations based on conditions
        const fertilizerRecommendations = this.getFertilizerRecommendations(conditions);
        recommendations.push(...fertilizerRecommendations);
        
        // Seasonal Recommendations
        const seasonalRecommendations = this.getSeasonalRecommendations(conditions);
        recommendations.push(...seasonalRecommendations);
        
        // ML-based yield prediction
        try {
            const mlStatus = await this.getMLPrediction();
            if (mlStatus && mlStatus.yield > 0) {
                recommendations.push({
                    icon: 'fa-chart-line',
                    color: 'text-indigo-500',
                    title: `ML Yield Prediction: ${mlStatus.yield}kg`,
                    description: `${mlStatus.message} (Confidence: ${Math.round(mlStatus.confidence)}%)`
                });
                
                // Add stage-specific recommendations based on predicted yield
                if (mlStatus.yield < 5) {
                    recommendations.push({
                        icon: 'fa-flask',
                        color: 'text-orange-500',
                        title: 'Nutrient Boost Needed',
                        description: 'Low predicted yield suggests nutrient deficiency. Consider applying NPK fertilizer with higher phosphorus content to promote flowering and fruit development.'
                    });
                } else if (mlStatus.yield > 15) {
                    recommendations.push({
                        icon: 'fa-star',
                        color: 'text-yellow-500',
                        title: 'Excellent Conditions',
                        description: 'Outstanding yield prediction! Maintain current practices. Consider harvesting preparation and post-harvest handling.'
                    });
                }
            }
        } catch (error) {
            console.error('Error getting ML prediction:', error);
            // Continue without ML recommendations if prediction fails
        }
        
        // Preventive care
        recommendations.push({
            icon: 'fa-shield-alt',
            color: 'text-purple-500',
            title: 'Preventive Care',
            description: 'Inspect leaves for signs of stress, ensure proper drainage, and maintain clean growing environment.'
        });
        
        return recommendations;
    }
    
    // Get growth stage-specific recommendations
    getGrowthStageRecommendations(conditions) {
        try {
            const recommendations = [];
            const currentMonth = new Date().getMonth() + 1; // 1-12
            
            // Flowering period recommendations (typically March-May and August-October)
            if ((currentMonth >= 3 && currentMonth <= 5) || (currentMonth >= 8 && currentMonth <= 10)) {
                recommendations.push({
                    icon: 'fa-seedling',
                    color: 'text-green-500',
                    title: 'Flowering Period',
                    description: 'Current season is optimal for flowering. Maintain humidity at 65-75% and temperature at 24-28°C for maximum flower retention and fruit set.'
                });
            }
            
            // Fruit development recommendations (typically June-September)
            if (currentMonth >= 6 && currentMonth <= 9) {
                recommendations.push({
                    icon: 'fa-apple-whole',
                    color: 'text-lime-500',
                    title: 'Fruit Development Stage',
                    description: 'Fruits are developing. Ensure consistent soil moisture (35-45%) and adequate potassium for fruit size and quality.'
                });
            }
            
            // Dormant period recommendations (typically November-February)
            if (currentMonth >= 11 || currentMonth <= 2) {
                recommendations.push({
                    icon: 'fa-snowflake',
                    color: 'text-blue-500',
                    title: 'Dormant Period',
                    description: 'Tree is dormant. Reduce watering frequency but maintain soil moisture at 25-35%. Prune dead branches and prepare for spring growth.'
                });
            }
            
            return recommendations;
        } catch (error) {
            console.error('Error in getGrowthStageRecommendations:', error);
            return []; // Always return an array
        }
    }
    
    // Get fertilizer-specific recommendations
    getFertilizerRecommendations(conditions) {
        try {
            const recommendations = [];
            
            // Based on current conditions, suggest appropriate fertilizers
            if (conditions.temperature.level === 'optimal' && conditions.soil.level === 'optimal' && conditions.humidity.level !== 'optimal') {
                // Good temperature and soil but humidity issues
                if (conditions.humidity.level === 'critical') {
                    recommendations.push({
                        icon: 'fa-sack-dollar',
                        color: 'text-amber-500',
                        title: 'Fertilizer Timing',
                        description: 'Avoid fertilizing during critical humidity conditions. Wait for conditions to stabilize before applying nutrients.'
                    });
                } else {
                    recommendations.push({
                        icon: 'fa-sack-dollar',
                        color: 'text-amber-500',
                        title: 'Fertilizer Application',
                        description: 'Conditions are favorable for nutrient uptake. Apply balanced NPK (14-14-14) fertilizer at 200g per tree.'
                    });
                }
            } else if (conditions.soil.level === 'critical') {
                recommendations.push({
                    icon: 'fa-sack-dollar',
                    color: 'text-red-500',
                    title: 'Soil Amendment Required',
                    description: 'Critical soil moisture detected. Apply organic matter and adjust watering before fertilizing to prevent nutrient burn.'
                });
            } else if (conditions.soil.level === 'warning') {
                recommendations.push({
                    icon: 'fa-sack-dollar',
                    color: 'text-amber-500',
                    title: 'Fertilizer Adjustment',
                    description: 'Suboptimal soil moisture. Reduce fertilizer concentration by 25% to prevent salt accumulation.'
                });
            } else {
                // Optimal conditions
                recommendations.push({
                    icon: 'fa-sack-dollar',
                    color: 'text-green-500',
                    title: 'Fertilizer Schedule',
                    description: 'Optimal conditions for fertilization. Apply complete fertilizer (NPK 12-12-17) every 2 weeks.'
                });
            }
            
            return recommendations;
        } catch (error) {
            console.error('Error in getFertilizerRecommendations:', error);
            return []; // Always return an array
        }
    }
    
    // Get seasonal recommendations
    getSeasonalRecommendations(conditions) {
        try {
            const recommendations = [];
            const currentMonth = new Date().getMonth() + 1;
            
            // Dry season recommendations (March-June)
            if (currentMonth >= 3 && currentMonth <= 6) {
                recommendations.push({
                    icon: 'fa-sun',
                    color: 'text-orange-500',
                    title: 'Dry Season Care',
                    description: 'Water conservation is crucial. Mulch around trees to retain moisture and water deeply but less frequently.'
                });
            }
            
            // Wet season recommendations (July-November)
            if (currentMonth >= 7 && currentMonth <= 11) {
                recommendations.push({
                    icon: 'fa-cloud-rain',
                    color: 'text-blue-500',
                    title: 'Wet Season Management',
                    description: 'Ensure good drainage to prevent root rot. Monitor for fungal diseases that thrive in wet conditions.'
                });
            }
            
            return recommendations;
        } catch (error) {
            console.error('Error in getSeasonalRecommendations:', error);
            return []; // Always return an array
        }
    }

    // Initialize ML Model
    async initMLModel() {
        console.log('🤖 Initializing ML Model...');
        
        // Check if model is already trained
        const modelStatus = mlModel.getStatus();
        
        if (!modelStatus.isTrained) {
            console.log('🔄 Training ML model...');
            const trainingSuccess = await mlModel.train();
            
            if (trainingSuccess) {
                console.log('✅ ML Model trained successfully');
                // Update UI to show ML is ready
                if (this.aiUi.status) {
                    this.aiUi.status.innerHTML = `<i class="fa-solid fa-check-circle text-green-500 mr-2"></i>ML Model Ready`;
                }
            } else {
                console.log('⚠️ ML Model training failed - insufficient data');
                if (this.aiUi.status) {
                    this.aiUi.status.innerHTML = `<i class="fa-solid fa-exclamation-triangle text-amber-500 mr-2"></i>Insufficient Data for ML`;
                }
            }
        } else {
            console.log('✅ ML Model already trained');
        }
    }

    // Run ML prediction on current data
    async runMLPrediction(currentData) {
        console.log('🤖 Running ML Prediction with current data:', currentData);
        
        // Check if model is trained first
        const modelStatus = mlModel.getStatus();
        console.log('📊 Model Status:', modelStatus);
        
        if (!modelStatus.isTrained) {
            console.log('⚠️ ML Model not trained yet');
            // Fallback: Show basic info even without ML prediction
            if (this.aiUi.yield) {
                this.aiUi.yield.innerText = 'ML Model: Ready for training';
            }
            if (this.aiUi.fert) {
                this.aiUi.fert.innerText = 'Generate training data to enable predictions';
            }
            return false;
        }
        
        // Get historical sensor data for context
        const historyData = await this.dataService.fetchHistory('months');
        console.log('📊 Historical data fetched:', historyData?.length || 0, 'records');
        
        // Format data for ML model - include both historical and current data
        let formattedData = [];
        
        // Add historical data first
        if (historyData && historyData.length > 0) {
            formattedData = historyData.map(record => ({
                temperature: record.temp,
                humidity: record.hum,
                avgSoilMoisture: record.soil,
                timestamp: new Date()
            }));
        }
        
        // Add current reading as the most recent data point (at the beginning for the ML model)
        formattedData.unshift({
            temperature: currentData[DB_CONFIG.fields.temp],
            humidity: currentData[DB_CONFIG.fields.hum],
            avgSoilMoisture: currentData[DB_CONFIG.fields.soil],
            timestamp: new Date()
        });
        
        console.log('📊 Formatted data for prediction:', formattedData);
        
        // Get prediction
        const prediction = mlModel.predict(formattedData);
        console.log('🔮 ML Prediction result:', prediction);
        console.log('🔍 Prediction validation:', {
            hasPrediction: !!prediction,
            yieldValue: prediction?.yield,
            yieldType: typeof prediction?.yield,
            yieldValid: prediction?.yield >= 0 && typeof prediction?.yield === 'number'
        });
        
        // Debug individual validation conditions
        console.log('🔍 Individual validation checks:', {
            hasPrediction: !!prediction,
            yieldIsNumber: typeof prediction?.yield === 'number',
            confidenceIsNumber: typeof prediction?.confidence === 'number',
            yieldNonNegative: prediction?.yield >= 0,
            yieldValue: prediction?.yield
        });
        
        // Validate prediction object structure
        if (prediction && 
            typeof prediction.yield === 'number' && 
            typeof prediction.confidence === 'number' &&
            prediction.yield >= 0) {
            console.log('✅ ML Prediction validation PASSED - updating UI');
            // Update yield impact display
            if (this.aiUi.yield) {
                this.aiUi.yield.innerText = `ML Prediction: ${prediction.yield.toFixed(1)}kg (${prediction.quality})`;
            }
            
            // Update fertilizer advice based on prediction
            if (this.aiUi.fert) {
                const confidenceLevel = prediction.confidence;
                if (confidenceLevel >= 80) {
                    this.aiUi.fert.innerText = `High confidence prediction. Fertilization safe.`;
                } else if (confidenceLevel >= 60) {
                    this.aiUi.fert.innerText = `Moderate confidence. Monitor conditions.`;
                } else {
                    this.aiUi.fert.innerText = `Low confidence. Focus on environmental optimization.`;
                }
            }
            
            // Update main status to show ML is active
            if (this.aiUi.status) {
                this.aiUi.status.innerHTML = `<i class="fa-solid fa-brain text-indigo-500 mr-2"></i>ML Model Active - ${prediction.yield.toFixed(1)}kg Predicted`;
            }
            
            return true; // ML prediction successful
        } else {
            console.log('⚠️ ML Prediction validation FAILED - showing fallback');
            console.log('🔍 Failed validation details:', {
                predictionExists: !!prediction,
                yieldType: typeof prediction?.yield,
                yieldValue: prediction?.yield,
                yieldCheck: prediction?.yield >= 0,
                confidenceType: typeof prediction?.confidence
            });
            
            // Show model status for debugging
            const modelStatus = mlModel.getStatus();
            console.log('📊 Model Status:', modelStatus);
            if (modelStatus.isTrained) {
                console.log('📊 Training Data Info:', {
                    sampleSize: modelStatus.sampleSize,
                    trainedAt: modelStatus.trainedAt,
                    coefficients: modelStatus.coefficients
                });
                
                // If model is trained but prediction failed, it might be due to poor data
                if (this.aiUi.yield) {
                    this.aiUi.yield.innerText = `ML Model: Trained (${modelStatus.sampleSize} samples) - Insufficient data for prediction`;
                }
                if (this.aiUi.fert) {
                    this.aiUi.fert.innerText = 'Check sensor data availability';
                }
            } else {
                // Fallback: Show basic info even without ML prediction
                if (this.aiUi.yield) {
                    this.aiUi.yield.innerText = 'ML Model: Ready for training';
                }
                if (this.aiUi.fert) {
                    this.aiUi.fert.innerText = 'Generate training data to enable predictions';
                }
            }
            return false; // ML prediction failed
        }
    }

    // Get current ML prediction for detailed recommendations (enhanced)
    async getMLPrediction() {
        try {
            // Need to get both historical data and current data for accurate prediction
            const historyData = await this.dataService.fetchHistory('months');
            
            // We need current data for prediction - use latest readings if available
            if (this.latestReadings) {
                let formattedData = [];
                
                // Add historical data if available
                if (historyData && historyData.length > 0) {
                    formattedData = historyData.map(record => ({
                        temperature: record.temp,
                        humidity: record.hum,
                        avgSoilMoisture: record.soil,
                        timestamp: new Date()
                    }));
                }
                
                // Add current reading
                formattedData.unshift({
                    temperature: this.latestReadings[DB_CONFIG.fields.temp],
                    humidity: this.latestReadings[DB_CONFIG.fields.hum],
                    avgSoilMoisture: this.latestReadings[DB_CONFIG.fields.soil],
                    timestamp: new Date()
                });
                
                const prediction = mlModel.predict(formattedData);
                
                // Enhance prediction with additional metadata for recommendations
                if (prediction && typeof prediction === 'object') {
                    // Add growth stage information
                    const currentMonth = new Date().getMonth() + 1;
                    let growthStage = 'Vegetative';
                    
                    if ((currentMonth >= 3 && currentMonth <= 5) || (currentMonth >= 8 && currentMonth <= 10)) {
                        growthStage = 'Flowering';
                    } else if (currentMonth >= 6 && currentMonth <= 9) {
                        growthStage = 'Fruit Development';
                    } else if (currentMonth >= 11 || currentMonth <= 2) {
                        growthStage = 'Dormant';
                    }
                    
                    prediction.growthStage = growthStage;
                    prediction.currentMonth = currentMonth;
                    
                    // Add fertilizer recommendation flag
                    prediction.fertilizerReady = prediction.confidence > 60 && 
                        this.latestReadings[DB_CONFIG.fields.soil] >= 25 && 
                        this.latestReadings[DB_CONFIG.fields.soil] <= 45;
                }
                
                return prediction;
            }
            
            return null;
        } catch (error) {
            console.error('Error in getMLPrediction:', error);
            return null; // Always return null in case of error
        }
    }

    // Setup ML Training UI
    setupMLTrainingUI() {
        const trainBtn = document.getElementById('train-model-btn');
        const statusIndicator = document.getElementById('ml-status-indicator');
        const trainingStatus = document.getElementById('training-status');
        
        if (trainBtn) {
            trainBtn.addEventListener('click', async () => {
                await this.trainModelManually(trainBtn, statusIndicator, trainingStatus);
            });
        }
    }

    // Manual model training
    async trainModelManually(trainBtn, statusIndicator, trainingStatus) {
        // Update UI for training state
        trainBtn.disabled = true;
        trainBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Training...';
        
        statusIndicator.innerHTML = '<div class="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></div><span class="text-xs text-slate-600">Training</span>';
        
        trainingStatus.classList.remove('hidden');
        trainingStatus.innerHTML = `
            <div class="space-y-2">
                <div class="flex items-center gap-2 text-blue-600">
                    <i class="fa-solid fa-circle-notch fa-spin"></i>
                    <span>Fetching training data from database...</span>
                </div>
            </div>
        `;
        
        try {
            console.log('🤖 Starting manual ML model training...');
            
            // Train the model
            const success = await mlModel.train();
            
            if (success) {
                trainingStatus.innerHTML = `
                    <div class="space-y-2">
                        <div class="flex items-center gap-2 text-green-600">
                            <i class="fa-solid fa-check-circle"></i>
                            <span>Model trained successfully!</span>
                        </div>
                        <div class="text-xs text-slate-600 ml-6">
                            Using existing database records for training
                        </div>
                    </div>
                `;
                
                statusIndicator.innerHTML = '<div class="w-3 h-3 rounded-full bg-green-500"></div><span class="text-xs text-slate-600">Trained</span>';
                trainBtn.innerHTML = '<i class="fa-solid fa-check mr-2"></i>Retrain Model';
                
                // Update dashboard predictions
                if (this.latestReadings) {
                    const predictionSuccess = await this.runMLPrediction(this.latestReadings);
                    if (predictionSuccess) {
                        console.log('✅ Dashboard updated with ML predictions');
                    }
                }
                
                // Show success message
                setTimeout(() => {
                    trainingStatus.classList.add('hidden');
                }, 5000);
                
            } else {
                throw new Error('Training failed - insufficient data');
            }
            
        } catch (error) {
            console.error('❌ ML Training Error:', error);
            
            trainingStatus.innerHTML = `
                <div class="space-y-2">
                    <div class="flex items-center gap-2 text-red-600">
                        <i class="fa-solid fa-exclamation-circle"></i>
                        <span>Training failed: ${error.message}</span>
                    </div>
                    <div class="text-xs text-slate-600 ml-6">
                        Ensure you have yield records in your database
                    </div>
                </div>
            `;
            
            statusIndicator.innerHTML = '<div class="w-3 h-3 rounded-full bg-red-500"></div><span class="text-xs text-slate-600">Error</span>';
            trainBtn.innerHTML = '<i class="fa-solid fa-rotate-right mr-2"></i>Retry Training';
            
            setTimeout(() => {
                trainingStatus.classList.add('hidden');
                trainBtn.disabled = false;
            }, 5000);
        } finally {
            if (trainBtn.disabled) {
                setTimeout(() => {
                    trainBtn.disabled = false;
                }, 1000);
            }
        }
    }
}

// Global function for ML metrics display
window.showMLMetrics = async function() {
    const modelStatus = mlModel.getStatus();
    const metrics = {
        isTrained: modelStatus.isTrained,
        trainedAt: modelStatus.trainedAt,
        sampleSize: modelStatus.sampleSize,
        coefficients: modelStatus.coefficients
    };
    
    // Show metrics in alert (can be enhanced with modal)
    let metricsText = `📊 ML Model Metrics\n\n`;
    metricsText += `Status: ${metrics.isTrained ? '✅ Trained' : '❌ Not Trained'}\n`;
    metricsText += `Training Date: ${metrics.trainedAt ? metrics.trainedAt.toLocaleString() : 'N/A'}\n`;
    metricsText += `Training Samples: ${metrics.sampleSize || 0}\n\n`;
    
    if (metrics.coefficients) {
        metricsText += `📈 Model Coefficients:\n`;
        metricsText += `  Temperature: ${metrics.coefficients.temp.toFixed(4)}\n`;
        metricsText += `  Humidity: ${metrics.coefficients.humidity.toFixed(4)}\n`;
        metricsText += `  Soil Moisture: ${metrics.coefficients.soil.toFixed(4)}\n`;
        metricsText += `  Intercept: ${metrics.coefficients.intercept.toFixed(4)}\n`;
    }
    
    alert(metricsText);
};

// Global function for data quality analysis
window.analyzeDataQuality = async function() {
    try {
        console.log('🔍 Starting data quality analysis...');
        await mlModel.analyzeDataQuality();
        alert('Data quality analysis complete. Check console for detailed results.');
    } catch (error) {
        console.error('❌ Data quality analysis failed:', error);
        alert('Analysis failed: ' + error.message);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.mlModel = mlModel; // Make mlModel globally accessible
    new DashboardApp();
});