/**
 * Rule Engine for Weather-Based Agronomic Recommendations
 * Declarative rules evaluated against AccuWeather data
 */

const logger = require("firebase-functions/logger");

/**
 * Default agronomic rules for calamansi farming.
 * These are seeded into Firestore on first run.
 */
const DEFAULT_RULES = [
  {
    ruleId: "extreme-heat-stress",
    name: "Extreme Heat Stress",
    description: "Temperature exceeds 35°C, risk of heat stress on trees",
    conditions: {
      "temperatureC": { "gte": 35 },
    },
    recommendation: {
      priority: "high",
      category: "protection",
      action: "Increase irrigation frequency and apply mulch to reduce soil temperature. Avoid pruning or fertilizing during peak heat.",
      icon: "temperature-high",
    },
    active: true,
  },
  {
    ruleId: "high-uv-risk",
    name: "High UV Exposure",
    description: "UV index is very high, risk of sunscald on fruit",
    conditions: {
      "uvIndex": { "gte": 8 },
      "cloudCover": { "lte": 20 },
    },
    recommendation: {
      priority: "medium",
      category: "protection",
      action: "Consider shade netting for young trees. Harvest mature fruit early morning to prevent sunburn.",
      icon: "sun",
    },
    active: true,
  },
  {
    ruleId: "high-humidity-fungal",
    name: "Fungal Disease Risk",
    description: "High humidity and warm temperature favor fungal growth",
    conditions: {
      "relativeHumidity": { "gte": 85 },
      "temperatureC": { "gte": 24, "lte": 30 },
    },
    recommendation: {
      priority: "high",
      category: "pest-disease",
      action: "Apply preventive fungicide. Ensure good canopy ventilation through selective pruning. Monitor for anthracnose.",
      icon: "bacterium",
    },
    active: true,
  },
  {
    ruleId: "low-humidity-irrigation",
    name: "Low Humidity - Increase Irrigation",
    description: "Low humidity increases transpiration rate",
    conditions: {
      "relativeHumidity": { "lte": 40 },
      "temperatureC": { "gte": 30 },
    },
    recommendation: {
      priority: "medium",
      category: "irrigation",
      action: "Increase drip irrigation duration. Consider afternoon misting to raise humidity around canopy.",
      icon: "droplet",
    },
    active: true,
  },
  {
    ruleId: "strong-wind-damage",
    name: "Strong Wind Risk",
    description: "Wind speeds above 30 km/h can damage branches and fruit",
    conditions: {
      "windSpeedKmh": { "gte": 30 },
    },
    recommendation: {
      priority: "high",
      category: "protection",
      action: "Secure young trees with stakes. Delay spraying operations. Check for fallen branches after wind subsides.",
      icon: "wind",
    },
    active: true,
  },
  {
    ruleId: "favorable-harvest",
    name: "Favorable Harvest Conditions",
    description: "Dry, mild weather ideal for harvesting",
    conditions: {
      "hasPrecipitation": { "eq": false },
      "temperatureC": { "gte": 20, "lte": 32 },
      "relativeHumidity": { "gte": 50, "lte": 75 },
      "windSpeedKmh": { "lte": 15 },
    },
    recommendation: {
      priority: "low",
      category: "harvest",
      action: "Ideal conditions for harvesting. Fruit will dry properly and have better shelf life.",
      icon: "basket",
    },
    active: true,
  },
  {
    ruleId: "cold-stress-warning",
    name: "Cold Stress Warning",
    description: "Temperature below 15°C can stress calamansi trees",
    conditions: {
      "temperatureC": { "lte": 15 },
    },
    recommendation: {
      priority: "high",
      category: "protection",
      action: "Cover young trees or use frost cloth. Delay fertilizer application until temperatures rise.",
      icon: "snowflake",
    },
    active: true,
  },
  {
    ruleId: "active-precipitation-delay-spray",
    name: "Active Rainfall - Delay Spraying",
    description: "Rain will wash off foliar applications",
    conditions: {
      "hasPrecipitation": { "eq": true },
    },
    recommendation: {
      priority: "medium",
      category: "protection",
      action: "Delay foliar fertilizer or pesticide application until rain stops and leaves dry.",
      icon: "cloud-rain",
    },
    active: true,
  },
];

/**
 * Extract normalized weather metrics from AccuWeather current conditions response
 */
function extractWeatherMetrics(weatherData) {
  const current = Array.isArray(weatherData) ? weatherData[0] : weatherData;
  if (!current) return null;

  return {
    temperatureC: current.Temperature?.Metric?.Value ?? null,
    temperatureF: current.Temperature?.Imperial?.Value ?? null,
    realFeelC: current.RealFeelTemperature?.Metric?.Value ?? null,
    relativeHumidity: current.RelativeHumidity ?? null,
    dewPointC: current.DewPoint?.Metric?.Value ?? null,
    windSpeedKmh: current.Wind?.Speed?.Metric?.Value ?? null,
    windGustKmh: current.WindGust?.Speed?.Metric?.Value ?? null,
    uvIndex: current.UVIndex ?? null,
    uvIndexText: current.UVIndexText ?? null,
    visibilityKm: current.Visibility?.Metric?.Value ?? null,
    cloudCover: current.CloudCover ?? null,
    pressureMb: current.Pressure?.Metric?.Value ?? null,
    hasPrecipitation: current.HasPrecipitation ?? false,
    precipitationType: current.PrecipitationType ?? null,
    precipitation1hrMm: current.Precip1hr?.Metric?.Value ?? 0,
    weatherText: current.WeatherText ?? null,
    weatherIcon: current.WeatherIcon ?? null,
    isDayTime: current.IsDayTime ?? null,
    observationTime: current.LocalObservationDateTime ?? null,
  };
}

/**
 * Evaluate a single condition against a metric value
 * Supported operators: eq, neq, gt, gte, lt, lte, in, nin
 */
function evaluateCondition(value, condition) {
  if (value === null || value === undefined) return false;

  for (const [op, target] of Object.entries(condition)) {
    switch (op) {
      case "eq":
        if (value !== target) return false;
        break;
      case "neq":
        if (value === target) return false;
        break;
      case "gt":
        if (!(value > target)) return false;
        break;
      case "gte":
        if (!(value >= target)) return false;
        break;
      case "lt":
        if (!(value < target)) return false;
        break;
      case "lte":
        if (!(value <= target)) return false;
        break;
      case "in":
        if (!Array.isArray(target) || !target.includes(value)) return false;
        break;
      case "nin":
        if (Array.isArray(target) && target.includes(value)) return false;
        break;
      default:
        logger.warn(`Unknown operator in rule condition: ${op}`);
        return false;
    }
  }
  return true;
}

/**
 * Evaluate a single rule against weather metrics
 */
function evaluateRule(rule, metrics) {
  if (!rule.active) return false;
  if (!rule.conditions) return false;

  for (const [field, condition] of Object.entries(rule.conditions)) {
    const value = metrics[field];
    if (!evaluateCondition(value, condition)) {
      return false;
    }
  }
  return true;
}

/**
 * Run all rules against weather data and return triggered recommendations
 */
function runRules(rules, weatherData) {
  const metrics = extractWeatherMetrics(weatherData);
  if (!metrics) {
    return { metrics: null, recommendations: [], error: "Invalid weather data" };
  }

  const triggered = [];
  for (const rule of rules) {
    if (evaluateRule(rule, metrics)) {
      triggered.push({
        ruleId: rule.ruleId,
        name: rule.name,
        description: rule.description,
        ...rule.recommendation,
      });
    }
  }

  // Sort by priority: high → medium → low
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  triggered.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    metrics,
    recommendations: triggered,
    triggeredCount: triggered.length,
  };
}

module.exports = {
  DEFAULT_RULES,
  extractWeatherMetrics,
  evaluateRule,
  runRules,
};
