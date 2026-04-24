/**
 * Cloud Functions for Calamansi Yield System
 * Phase 1: Weather API Proxy + Firestore Cache
 */

const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { DEFAULT_RULES, runRules } = require("./rules");

admin.initializeApp();

const db = getFirestore();
const CACHE_COLLECTION = "weather_cache";
const RULES_COLLECTION = "agronomic_rules";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Helper: Seed default rules into Firestore if collection is empty
 */
async function seedDefaultRules() {
  const rulesRef = db.collection(RULES_COLLECTION);
  const snapshot = await rulesRef.limit(1).get();
  if (!snapshot.empty) return;

  logger.info("Seeding default agronomic rules...");
  const batch = db.batch();
  for (const rule of DEFAULT_RULES) {
    const docRef = rulesRef.doc(rule.ruleId);
    batch.set(docRef, {
      ...rule,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  logger.info(`Seeded ${DEFAULT_RULES.length} default rules.`);
}

/**
 * Helper: Load active rules from Firestore
 */
async function loadRules() {
  await seedDefaultRules();
  const snapshot = await db.collection(RULES_COLLECTION)
    .where("active", "==", true)
    .get();
  return snapshot.docs.map((doc) => doc.data());
}

/**
 * Helper: Fetch weather from AccuWeather API
 */
async function fetchAccuWeather(locationKey, apiKey) {
  const url = `http://dataservice.accuweather.com/currentconditions/v1/${locationKey}?apikey=${apiKey}&details=true`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`AccuWeather API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Helper: Get cached weather or null
 * staleAllowed = true returns expired cache as fallback
 */
async function getCachedWeather(locationKey, staleAllowed = false) {
  const docRef = db.collection(CACHE_COLLECTION).doc(locationKey);
  const doc = await docRef.get();
  if (!doc.exists) return null;

  const data = doc.data();
  const age = Date.now() - data.timestamp.toMillis();
  if (age > CACHE_TTL_MS && !staleAllowed) return null;

  return { ...data, stale: age > CACHE_TTL_MS };
}

/**
 * Helper: Save weather to cache
 */
async function saveWeatherCache(locationKey, weatherData) {
  const docRef = db.collection(CACHE_COLLECTION).doc(locationKey);
  await docRef.set({
    locationKey,
    data: weatherData,
    timestamp: FieldValue.serverTimestamp(),
  });
}

/**
 * HTTP Function: getWeather
 * Proxies AccuWeather API with Firestore caching
 */
exports.getWeather = onRequest(
  {
    cors: {
      origin: true, // Restrict in production to your Firebase Hosting domain
    },
    secrets: ["ACCUWEATHER_API_KEY"],
  },
  async (req, res) => {
    try {
      const locationKey = req.query.locationKey;
      if (!locationKey) {
        res.status(400).json({error: "Missing locationKey parameter"});
        return;
      }

      // 1. Check Firestore cache
      const cached = await getCachedWeather(locationKey);
      if (cached) {
        logger.info("Cache hit for locationKey:", locationKey);
        res.json({
          source: "cache",
          cachedAt: cached.timestamp,
          data: cached.data,
        });
        return;
      }

      // 2. Fetch from AccuWeather
      const apiKey = process.env.ACCUWEATHER_API_KEY;
      if (!apiKey) {
        res.status(500).json({error: "API key not configured"});
        return;
      }

      logger.info("Cache miss - fetching AccuWeather for:", locationKey);
      const weatherData = await fetchAccuWeather(locationKey, apiKey);

      // 3. Save to cache
      await saveWeatherCache(locationKey, weatherData);

      res.json({
        source: "api",
        data: weatherData,
      });
    } catch (error) {
      logger.error("getWeather error:", error);
      res.status(500).json({error: error.message});
    }
  }
);

/**
 * HTTP Function: getRecommendations
 * Fetches weather + evaluates agronomic rules, returns actionable advice
 */
exports.getRecommendations = onRequest(
  {
    cors: {
      origin: true,
    },
    secrets: ["ACCUWEATHER_API_KEY"],
  },
  async (req, res) => {
    try {
      const locationKey = req.query.locationKey;
      if (!locationKey) {
        res.status(400).json({error: "Missing locationKey parameter"});
        return;
      }

      // 1. Get weather data (cache first, then API, then stale cache as fallback)
      let weatherData;
      let weatherSource;
      const cached = await getCachedWeather(locationKey);
      if (cached) {
        weatherData = cached.data;
        weatherSource = cached.stale ? "stale_cache" : "cache";
      } else {
        const apiKey = process.env.ACCUWEATHER_API_KEY;
        if (!apiKey) {
          res.status(500).json({error: "API key not configured"});
          return;
        }
        try {
          weatherData = await fetchAccuWeather(locationKey, apiKey);
          await saveWeatherCache(locationKey, weatherData);
          weatherSource = "api";
        } catch (apiError) {
          // Fallback to stale cache if API fails
          const staleCached = await getCachedWeather(locationKey, true);
          if (staleCached) {
            logger.warn("AccuWeather API failed, returning stale cache:", apiError.message);
            weatherData = staleCached.data;
            weatherSource = "stale_cache";
          } else {
            throw apiError;
          }
        }
      }

      // 2. Load rules and evaluate
      const rules = await loadRules();
      const result = runRules(rules, weatherData);

      res.json({
        locationKey,
        weatherSource,
        evaluatedAt: new Date().toISOString(),
        ...result,
      });
    } catch (error) {
      logger.error("getRecommendations error:", error);
      res.status(500).json({error: error.message});
    }
  }
);
