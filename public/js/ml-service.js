import { app } from '../firebase-config.js';
import { 
    getFirestore, 
    collection, 
    query, 
    orderBy, 
    limit, 
    getDocs,
    where
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

const db = getFirestore(app);

// ------------------------------------------------------------------
// ML CONFIGURATION
// ------------------------------------------------------------------
const DB_CONFIG = {
    sensorCollection: 'dataCollectionSensor',
    yieldCollection: 'farm_history',
    predictionCollection: 'ml_predictions'
};

const SENSOR_FIELDS = {
    temp: 'temperature',
    hum: 'humidity',
    soil: 'avgSoilMoisture',
    time: 'timestamp'
};

// Optimal ranges for calamansi growth
const OPTIMAL_RANGES = {
    temperature: { min: 22, max: 30, ideal: 26 },
    humidity: { min: 60, max: 80, ideal: 70 },
    soilMoisture: { min: 25, max: 45, ideal: 35 }
};

// ------------------------------------------------------------------
// ML MODEL CLASS
// ------------------------------------------------------------------
class YieldPredictionModel {
    constructor() {
        this.model = null;
        this.isTrained = false;
        this.trainingData = [];
        this.featureStats = {};
    }

    // Fetch historical data for training
    async fetchTrainingData() {
        try {
            // Fetch sensor data
            const sensorQuery = query(
                collection(db, DB_CONFIG.sensorCollection),
                orderBy(SENSOR_FIELDS.time, 'desc'),
                limit(1000) // Last 1000 sensor readings
            );
            
            const yieldQuery = query(
                collection(db, DB_CONFIG.yieldCollection),
                orderBy('harvestDate', 'desc'),
                limit(50) // Last 50 harvest records
            );

            const [sensorSnapshot, yieldSnapshot] = await Promise.all([
                getDocs(sensorQuery),
                getDocs(yieldQuery)
            ]);

            console.log(`📊 Fetched ${sensorSnapshot.docs.length} sensor documents and ${yieldSnapshot.docs.length} yield documents`);
            
            // Debug: Log sample data structure
            if (sensorSnapshot.docs.length > 0) {
                console.log('🔍 Sample sensor data:', sensorSnapshot.docs[0].data());
            }
            if (yieldSnapshot.docs.length > 0) {
                console.log('🔍 Sample yield data:', yieldSnapshot.docs[0].data());
            }

            const sensorData = sensorSnapshot.docs.map(doc => {
                const data = doc.data();
                let timestamp;
                
                // Handle different timestamp formats
                if (data[SENSOR_FIELDS.time]) {
                    if (typeof data[SENSOR_FIELDS.time].toDate === 'function') {
                        // Firebase Timestamp object
                        timestamp = data[SENSOR_FIELDS.time].toDate();
                    } else if (data[SENSOR_FIELDS.time] instanceof Date) {
                        // Already a Date object
                        timestamp = data[SENSOR_FIELDS.time];
                    } else {
                        // String or number timestamp
                        timestamp = new Date(data[SENSOR_FIELDS.time]);
                    }
                } else {
                    timestamp = new Date();
                }
                
                return {
                    id: doc.id,
                    ...data,
                    timestamp: timestamp
                };
            });

            const yieldData = yieldSnapshot.docs.map(doc => {
                const data = doc.data();
                let harvestDate;
                
                // Handle different date formats
                if (data.harvestDate) {
                    if (typeof data.harvestDate.toDate === 'function') {
                        // Firebase Timestamp object
                        harvestDate = data.harvestDate.toDate();
                    } else if (data.harvestDate instanceof Date) {
                        // Already a Date object
                        harvestDate = data.harvestDate;
                    } else {
                        // String or number date
                        harvestDate = new Date(data.harvestDate);
                    }
                } else {
                    harvestDate = new Date();
                }
                
                return {
                    id: doc.id,
                    ...data,
                    harvestDate: harvestDate
                };
            });

            // Debug: Show raw data structure
            console.log('🔍 Raw sensor data sample:', sensorData.slice(0, 2));
            console.log('🔍 Raw yield data sample:', yieldData.slice(0, 2));
            
            // Filter out invalid data
            const validSensorData = sensorData.filter(data => 
                data.temperature != null && 
                data.humidity != null && 
                data.avgSoilMoisture != null && 
                data.timestamp instanceof Date && 
                !isNaN(data.timestamp.getTime())
            );
            
            console.log(`📊 Raw sensor data: ${sensorData.length}, Valid sensor data: ${validSensorData.length}`);
            
            const validYieldData = yieldData.filter(data => 
                (data.harvestYield || data.yieldAmount || data.yield || data.weight) &&
                data.harvestDate instanceof Date && 
                !isNaN(data.harvestDate.getTime())
            );

            console.log(`✅ Processed ${validSensorData.length} valid sensor records and ${validYieldData.length} valid yield records`);
            
            return { sensorData: validSensorData, yieldData: validYieldData };
        } catch (error) {
            console.error('Error fetching training data:', error);
            return { sensorData: [], yieldData: [] };
        }
    }

    // Preprocess data and create features
    preprocessData(sensorData, yieldData) {
        if (!sensorData.length || !yieldData.length) {
            console.warn('Insufficient data for preprocessing');
            return null;
        }

        // Create time-based features
        const features = [];
        
        // Debug: Show date ranges
        if (sensorData.length > 0 && yieldData.length > 0) {
            const sensorDates = sensorData.map(s => s.timestamp);
            const yieldDates = yieldData.map(y => y.harvestDate);
            console.log('📅 Sensor data range:', new Date(Math.min(...sensorDates.map(d => d.getTime()))), 'to', new Date(Math.max(...sensorDates.map(d => d.getTime()))));
            console.log('📅 Yield data range:', new Date(Math.min(...yieldDates.map(d => d.getTime()))), 'to', new Date(Math.max(...yieldDates.map(d => d.getTime()))));
        }
        
        yieldData.forEach((yieldRecord, index) => {
            const harvestDate = yieldRecord.harvestDate;
            
            // Try multiple time windows to find matching sensor data
            const timeWindows = [
                { days: 30, name: '30 days' },
                { days: 60, name: '60 days' },
                { days: 15, name: '15 days' },
                { days: 90, name: '90 days' },
                { days: 45, name: '45 days' },
                { days: 120, name: '120 days' }
            ];
            
            let relevantSensorData = [];
            let usedWindow = '';
            let bestMatch = { data: [], window: '', score: 0 };
            
            // Debug: Show date comparison
            console.log(`🔍 Yield record ${index + 1} date:`, harvestDate.toLocaleDateString());
            
            // Try each time window and find the best match
            for (const window of timeWindows) {
                const startDate = new Date(harvestDate);
                startDate.setDate(startDate.getDate() - window.days);
                
                const windowData = sensorData.filter(sensor => {
                    const sensorDate = sensor.timestamp;
                    return sensorDate >= startDate && sensorDate <= harvestDate;
                });
                
                // Debug: Show window matching results
                if (windowData.length > 0) {
                    const windowDates = windowData.map(w => w.timestamp.getTime());
                    console.log(`  📅 ${window.name} window: ${windowData.length} records`);
                    console.log(`    Date range: ${new Date(Math.min(...windowDates)).toLocaleDateString()} to ${new Date(Math.max(...windowDates)).toLocaleDateString()}`);
                }
                
                // Calculate match quality score
                const matchScore = this.calculateTemporalMatchScore(windowData, window.days);
                
                // More flexible matching criteria
                if (windowData.length >= 3 && matchScore > bestMatch.score) {
                    bestMatch = { 
                        data: windowData, 
                        window: window.name, 
                        score: matchScore 
                    };
                }
            }
            
            // Use the best match if found, otherwise fallback
            if (bestMatch.data.length > 0) {
                relevantSensorData = bestMatch.data;
                usedWindow = bestMatch.window;
            }

            if (relevantSensorData.length > 0) {
                console.log(`📊 Yield record ${index + 1}: Found ${relevantSensorData.length} sensor records in ${usedWindow} window (score: ${bestMatch.score?.toFixed(1) || 'N/A'})`);
            } else {
                // Fallback: Use all sensor data if no temporal correlation
                console.log(`⚠️ Yield record ${index + 1}: No temporal match found, using all ${sensorData.length} sensor records`);
                relevantSensorData = sensorData;
                usedWindow = 'all data (fallback)';
                console.log(`📊 Yield record ${index + 1}: Using ${relevantSensorData.length} sensor records in ${usedWindow} approach`);
            }
            
            // Only proceed if we have data
            if (relevantSensorData.length > 0) {
                // Calculate aggregated features
                const avgTemp = this.calculateAverage(relevantSensorData, SENSOR_FIELDS.temp);
                const avgHumidity = this.calculateAverage(relevantSensorData, SENSOR_FIELDS.hum);
                const avgSoilMoisture = this.calculateAverage(relevantSensorData, SENSOR_FIELDS.soil);
                
                const tempStability = this.calculateStability(relevantSensorData, SENSOR_FIELDS.temp);
                const humidityStability = this.calculateStability(relevantSensorData, SENSOR_FIELDS.hum);
                const soilStability = this.calculateStability(relevantSensorData, SENSOR_FIELDS.soil);

                // Extract yield amount (handle different field names)
                const yieldAmount = parseFloat(
                    yieldRecord.harvestYield || 
                    yieldRecord.yieldAmount || 
                    yieldRecord.yield || 
                    yieldRecord.weight || 0
                );

                if (yieldAmount > 0) {
                    features.push({
                        avgTemp,
                        avgHumidity,
                        avgSoilMoisture,
                        tempStability,
                        humidityStability,
                        soilStability,
                        daysToHarvest: usedWindow.includes('days') ? parseInt(usedWindow) : 30,
                        yield: yieldAmount,
                        quality: yieldRecord.quality || 'Unknown',
                        harvestDate: yieldRecord.harvestDate,
                        approach: usedWindow
                    });
                }
            }
        });

        return features;
    }

    // Calculate average of a field
    calculateAverage(data, field) {
        // Handle potential field name variations
        let actualField = field;
        
        // Check if field exists, if not try alternatives
        if (!data[0] || !(field in data[0])) {
            const alternatives = {
                'avgSoilMoisture': ['soilMoisture', 'soil', 'moisture'],
                'temperature': ['temp', 'Temperature'],
                'humidity': ['hum', 'Humidity']
            };
            
            if (alternatives[field]) {
                for (const alt of alternatives[field]) {
                    if (data[0] && alt in data[0]) {
                        actualField = alt;
                        console.log(`🔄 Using alternative field name: ${field} -> ${actualField}`);
                        break;
                    }
                }
            }
        }
        
        const values = data.map(item => parseFloat(item[actualField])).filter(val => !isNaN(val));
        console.log(`📊 Calculating average for ${field} (using ${actualField}):`, values.slice(0, 5), `... (total: ${values.length})`);
        const result = values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
        console.log(`📊 Average for ${field}: ${result}`);
        
        if (values.length === 0) {
            console.warn(`⚠️ No valid data found for field ${field} (${actualField})`);
        }
        
        return result;
    }

    // Calculate stability (standard deviation)
    calculateStability(data, field) {
        const values = data.map(item => parseFloat(item[field])).filter(val => !isNaN(val));
        if (values.length <= 1) return 0;
        
        const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
        return Math.sqrt(variance);
    }
    
    // Calculate temporal match quality score
    calculateTemporalMatchScore(sensorData, windowDays) {
        if (sensorData.length < 3) return 0;
        
        // Score based on data density (records per day)
        const dataDensity = sensorData.length / windowDays;
        
        // Score based on data distribution (prefer more recent data)
        const dates = sensorData.map(s => s.timestamp.getTime());
        const dateRange = Math.max(...dates) - Math.min(...dates);
        const timeCoverage = dateRange > 0 ? windowDays * 24 * 60 * 60 * 1000 / dateRange : 0;
        
        // Combined score (0-100)
        const densityScore = Math.min(100, dataDensity * 20); // Up to 5 records per day
        const coverageScore = Math.min(100, timeCoverage * 100); // Percentage coverage
        
        return (densityScore * 0.6 + coverageScore * 0.4); // Weighted average
    }

    // Train the model using linear regression approach
    trainModel(features) {
        if (!features || features.length < 3) {
            console.warn('Insufficient training data');
            return false;
        }

        // Simple linear regression implementation
        const n = features.length;
        
        // Calculate means
        const meanTemp = features.reduce((sum, f) => sum + f.avgTemp, 0) / n;
        const meanHumidity = features.reduce((sum, f) => sum + f.avgHumidity, 0) / n;
        const meanSoil = features.reduce((sum, f) => sum + f.avgSoilMoisture, 0) / n;
        const meanYield = features.reduce((sum, f) => sum + f.yield, 0) / n;

        // Calculate standard deviations for normalization
        let tempSumSq = 0, humSumSq = 0, soilSumSq = 0, yieldSumSq = 0;
        features.forEach(feature => {
            tempSumSq += Math.pow(feature.avgTemp - meanTemp, 2);
            humSumSq += Math.pow(feature.avgHumidity - meanHumidity, 2);
            soilSumSq += Math.pow(feature.avgSoilMoisture - meanSoil, 2);
            yieldSumSq += Math.pow(feature.yield - meanYield, 2);
        });
        
        const stdTemp = Math.sqrt(tempSumSq / n);
        const stdHumidity = Math.sqrt(humSumSq / n);
        const stdSoil = Math.sqrt(soilSumSq / n);
        const stdYield = Math.sqrt(yieldSumSq / n);

        // Calculate regression coefficients
        let sumTempYield = 0, sumHumidityYield = 0, sumSoilYield = 0;
        let sumTemp2 = 0, sumHumidity2 = 0, sumSoil2 = 0;

        features.forEach(feature => {
            sumTempYield += (feature.avgTemp - meanTemp) * (feature.yield - meanYield);
            sumHumidityYield += (feature.avgHumidity - meanHumidity) * (feature.yield - meanYield);
            sumSoilYield += (feature.avgSoilMoisture - meanSoil) * (feature.yield - meanYield);
            
            sumTemp2 += Math.pow(feature.avgTemp - meanTemp, 2);
            sumHumidity2 += Math.pow(feature.avgHumidity - meanHumidity, 2);
            sumSoil2 += Math.pow(feature.avgSoilMoisture - meanSoil, 2);
        });

        // Regression coefficients (with safeguards against division by zero)
        const betaTemp = sumTemp2 > 0 ? sumTempYield / sumTemp2 : 0;
        const betaHumidity = sumHumidity2 > 0 ? sumHumidityYield / sumHumidity2 : 0;
        const betaSoil = sumSoil2 > 0 ? sumSoilYield / sumSoil2 : 0;

        // Intercept
        const intercept = meanYield - 
                         (betaTemp * meanTemp) - 
                         (betaHumidity * meanHumidity) - 
                         (betaSoil * meanSoil);

        // Store normalized coefficients for prediction stability
        this.model = {
            coefficients: {
                temp: betaTemp,
                humidity: betaHumidity,
                soil: betaSoil,
                intercept: intercept
            },
            stats: {
                meanTemp: meanTemp,
                meanHumidity: meanHumidity,
                meanSoil: meanSoil,
                meanYield: meanYield,
                stdTemp: stdTemp,
                stdHumidity: stdHumidity,
                stdSoil: stdSoil,
                stdYield: stdYield
            },
            trainedAt: new Date(),
            sampleSize: n
        };

        this.isTrained = true;
        console.log('✅ Model trained successfully with', n, 'samples');
        console.log('📊 Coefficients:', {
            temp: betaTemp,
            humidity: betaHumidity,
            soil: betaSoil,
            intercept: intercept
        });
        return true;
    }

    // Make prediction based on current sensor data
    predict(currentSensorData) {
        if (!this.isTrained || !this.model) {
            return {
                yield: 0,
                confidence: 0,
                message: 'Model not trained yet',
                quality: 'Unknown'
            };
        }

        // Calculate 30-day averages from current data
        const features = this.extractCurrentFeatures(currentSensorData);
        
        if (!features) {
            return {
                yield: 0,
                confidence: 0,
                message: 'Insufficient current data',
                quality: 'Unknown'
            };
        }

        // Debug logging
        console.log('🔍 Prediction inputs:', {
            intercept: this.model.coefficients.intercept,
            temp: features.avgTemp,
            humidity: features.avgHumidity,
            soil: features.avgSoilMoisture,
            coefficients: this.model.coefficients
        });
        
        console.log('📊 Input features:', features);
        console.log('📊 Model coefficients:', this.model.coefficients);

        // Calculate a more balanced prediction that caps individual coefficient impacts
        // This prevents extreme values caused by very negative coefficients
        
        // Calculate the impact of each feature but cap the effect of any single coefficient
        const tempEffect = (features.avgTemp - OPTIMAL_RANGES.temperature.ideal) * this.model.coefficients.temp;
        const cappedTempEffect = Math.max(-5, Math.min(5, tempEffect)); // Cap between -5 and 5
        
        const humidityEffect = (features.avgHumidity - OPTIMAL_RANGES.humidity.ideal) * this.model.coefficients.humidity;
        const cappedHumidityEffect = Math.max(-10, Math.min(5, humidityEffect)); // Cap humidity effect more aggressively
        
        const soilEffect = (features.avgSoilMoisture - OPTIMAL_RANGES.soilMoisture.ideal) * this.model.coefficients.soil;
        const cappedSoilEffect = Math.max(-5, Math.min(5, soilEffect)); // Cap between -5 and 5
        
        // Calculate a baseline yield estimate based on training data average
        const baselineYield = this.model.stats?.meanYield || 10; // Default to 10kg if not available
        
        // Combine capped effects
        const combinedEffect = cappedTempEffect + cappedHumidityEffect + cappedSoilEffect;
        
        // Calculate predicted yield with the combined effect
        let predictedYield = baselineYield + combinedEffect;
        
        // Ensure the prediction is within reasonable bounds
        predictedYield = Math.max(0.1, Math.min(predictedYield, baselineYield * 3)); // Minimum 0.1kg, max 3x baseline
        
        console.log('📊 Normalized prediction components:', {
            baselineYield: baselineYield,
            tempEffect: tempEffect,
            cappedTempEffect: cappedTempEffect,
            humidityEffect: humidityEffect,
            cappedHumidityEffect: cappedHumidityEffect,
            soilEffect: soilEffect,
            cappedSoilEffect: cappedSoilEffect,
            combinedEffect: combinedEffect,
            predictedYield: predictedYield
        });

        // Calculate confidence based on how close current conditions are to optimal
        const confidence = this.calculateConfidence(features);
        
        // Predict quality based on conditions
        const quality = this.predictQuality(features);

        console.log('📊 Final prediction values:', {
            rawYield: predictedYield,
            confidence: confidence,
            quality: quality
        });
        
        return {
            yield: predictedYield,
            confidence: Math.min(100, Math.max(0, confidence)),
            message: this.generatePredictionMessage(predictedYield, confidence, features),
            quality: quality,
            features: features
        };
    }

    // Extract features from current sensor data
    extractCurrentFeatures(sensorData) {
        if (!sensorData || sensorData.length === 0) return null;

        // Take last 30 days of data (or all available)
        const recentData = sensorData.slice(0, Math.min(30, sensorData.length));
        
        // Debug logging
        console.log('🔍 Extracting features from', recentData.length, 'sensor records');
        console.log('📊 Sample data:', recentData.slice(0, 3));
        
        // Check field structure
        if (recentData.length > 0) {
            const sample = recentData[0];
            console.log('🔍 Field structure check:', {
                hasTemperature: 'temperature' in sample,
                hasHumidity: 'humidity' in sample,
                hasAvgSoilMoisture: 'avgSoilMoisture' in sample,
                hasSoilMoisture: 'soilMoisture' in sample,
                hasTimestamp: 'timestamp' in sample,
                actualFields: Object.keys(sample),
                sampleData: sample
            });
        }
        
        const avgTemp = this.calculateAverage(recentData, SENSOR_FIELDS.temp);
        const avgHumidity = this.calculateAverage(recentData, SENSOR_FIELDS.hum);
        const avgSoilMoisture = this.calculateAverage(recentData, SENSOR_FIELDS.soil);
        
        console.log('📊 Calculated averages:', { avgTemp, avgHumidity, avgSoilMoisture });
        
        return {
            avgTemp: avgTemp,
            avgHumidity: avgHumidity,
            avgSoilMoisture: avgSoilMoisture,
            tempStability: this.calculateStability(recentData, SENSOR_FIELDS.temp),
            humidityStability: this.calculateStability(recentData, SENSOR_FIELDS.hum),
            soilStability: this.calculateStability(recentData, SENSOR_FIELDS.soil)
        };
    }

    // Calculate prediction confidence
    calculateConfidence(features) {
        let score = 100;
        
        // Temperature factor
        const tempDiff = Math.abs(features.avgTemp - OPTIMAL_RANGES.temperature.ideal);
        score -= Math.min(50, tempDiff * 3);
        
        // Humidity factor
        const humDiff = Math.abs(features.avgHumidity - OPTIMAL_RANGES.humidity.ideal);
        score -= Math.min(30, humDiff * 2);
        
        // Soil moisture factor
        const soilDiff = Math.abs(features.avgSoilMoisture - OPTIMAL_RANGES.soilMoisture.ideal);
        score -= Math.min(20, soilDiff * 2);
        
        return Math.max(0, score);
    }

    // Predict quality grade
    predictQuality(features) {
        let score = 0;
        
        // Temperature scoring (30 points)
        const tempScore = this.scoreParameter(
            features.avgTemp, 
            OPTIMAL_RANGES.temperature.min, 
            OPTIMAL_RANGES.temperature.max,
            OPTIMAL_RANGES.temperature.ideal
        );
        score += tempScore * 0.3;
        
        // Humidity scoring (30 points)
        const humScore = this.scoreParameter(
            features.avgHumidity,
            OPTIMAL_RANGES.humidity.min,
            OPTIMAL_RANGES.humidity.max,
            OPTIMAL_RANGES.humidity.ideal
        );
        score += humScore * 0.3;
        
        // Soil moisture scoring (40 points)
        const soilScore = this.scoreParameter(
            features.avgSoilMoisture,
            OPTIMAL_RANGES.soilMoisture.min,
            OPTIMAL_RANGES.soilMoisture.max,
            OPTIMAL_RANGES.soilMoisture.ideal
        );
        score += soilScore * 0.4;
        
        // Convert score to quality grade
        if (score >= 85) return 'Grade A';
        if (score >= 70) return 'Grade B';
        return 'Grade C';
    }

    // Helper function to score parameter against optimal range
    scoreParameter(value, min, max, ideal) {
        if (value >= min && value <= max) {
            // Within optimal range - score based on proximity to ideal
            const distance = Math.abs(value - ideal);
            const range = (max - min) / 2;
            return Math.max(0, 100 - (distance / range) * 50);
        } else {
            // Outside range - penalize heavily
            const penalty = Math.min(50, Math.abs(value - (value < min ? min : max)) * 10);
            return Math.max(0, 50 - penalty);
        }
    }

    // Generate user-friendly prediction message
    generatePredictionMessage(yieldPred, confidence, features) {
        const yieldRounded = Math.round(yieldPred * 10) / 10;
        
        if (confidence >= 80) {
            return `Excellent conditions! Expected yield: ${yieldRounded}kg with Grade A quality.`;
        } else if (confidence >= 60) {
            return `Good conditions. Expected yield: ${yieldRounded}kg. Monitor temperature and humidity.`;
        } else if (confidence >= 40) {
            return `Moderate conditions. Expected yield: ${yieldRounded}kg. Consider adjusting environmental controls.`;
        } else {
            return `Suboptimal conditions. Expected yield: ${yieldRounded}kg. Immediate adjustments recommended.`;
        }
    }

    // Main training workflow
    async train() {
        console.log('🤖 Starting ML model training...');
        
        const { sensorData, yieldData } = await this.fetchTrainingData();
        console.log(`📊 Retrieved ${sensorData.length} sensor records and ${yieldData.length} yield records`);
        
        if (sensorData.length < 10 || yieldData.length < 2) {
            console.warn('⚠️ Insufficient data for training');
            return false;
        }
        
        const features = this.preprocessData(sensorData, yieldData);
        if (!features || features.length < 3) {
            console.warn('⚠️ Insufficient processed features for training');
            return false;
        }
        
        console.log(`⚙️ Processed ${features.length} training samples`);
        
        const success = this.trainModel(features);
        if (success) {
            console.log('✅ ML model training completed successfully');
        }
        
        return success;
    }

    // Get model status
    getStatus() {
        return {
            isTrained: this.isTrained,
            trainedAt: this.model?.trainedAt || null,
            sampleSize: this.model?.sampleSize || 0,
            coefficients: this.model?.coefficients || null,
            stats: this.model?.stats || null
        };
    }
    
    // Analyze data quality for better predictions
    async analyzeDataQuality() {
        const { sensorData, yieldData } = await this.fetchTrainingData();
        
        console.log('📊 Data Quality Analysis:');
        console.log('📊 Sensor Records:', sensorData.length);
        console.log('📊 Yield Records:', yieldData.length);
                    
        // Show actual data structure
        if (sensorData.length > 0) {
            console.log('🔍 Sensor Data Structure Sample:');
            console.log('  First record fields:', Object.keys(sensorData[0]));
            console.log('  Sample data:', sensorData[0]);
                        
            // Check for common field names
            const commonFields = ['temperature', 'temp', 'humidity', 'hum', 'avgSoilMoisture', 'soilMoisture', 'soil', 'timestamp', 'time'];
            const foundFields = commonFields.filter(field => field in sensorData[0]);
            console.log('  Found fields:', foundFields);
            console.log('  Missing fields:', commonFields.filter(field => !(field in sensorData[0])));
        }
                    
        // Analyze timestamp distribution
        if (sensorData.length > 0) {
            const sensorDates = sensorData.map(s => s.timestamp.getTime());
            const dateRange = Math.max(...sensorDates) - Math.min(...sensorDates);
            const daysRange = dateRange / (24 * 60 * 60 * 1000);
            
            console.log('📊 Sensor Data Time Range:');
            console.log('  Date Range:', daysRange.toFixed(1), 'days');
            console.log('  Date Min:', new Date(Math.min(...sensorDates)).toLocaleDateString());
            console.log('  Date Max:', new Date(Math.max(...sensorDates)).toLocaleDateString());
            
            // Check for data duplication
            const uniqueDates = [...new Set(sensorDates.map(d => new Date(d).toDateString()))];
            console.log('  Unique Days:', uniqueDates.length);
            console.log('  Data Points per Day (avg):', (sensorData.length / uniqueDates.length).toFixed(1));
        }
        
        if (yieldData.length > 0) {
            const yieldDates = yieldData.map(y => y.harvestDate.getTime());
            const yieldRange = Math.max(...yieldDates) - Math.min(...yieldDates);
            const yieldDaysRange = yieldRange / (24 * 60 * 60 * 1000);
            
            console.log('📊 Yield Data Time Range:');
            console.log('  Date Range:', yieldDaysRange.toFixed(1), 'days');
            console.log('  Date Min:', new Date(Math.min(...yieldDates)).toLocaleDateString());
            console.log('  Date Max:', new Date(Math.max(...yieldDates)).toLocaleDateString());
        }
        
        if (sensorData.length > 0) {
            const temps = sensorData.map(s => s.temperature).filter(t => t != null);
            const hums = sensorData.map(s => s.humidity).filter(h => h != null);
            const soils = sensorData.map(s => s.avgSoilMoisture).filter(s => s != null);
            
            console.log('📊 Sensor Data Range:');
            console.log('  Temperature:', Math.min(...temps), 'to', Math.max(...temps), '°C');
            console.log('  Humidity:', Math.min(...hums), 'to', Math.max(...hums), '%');
            console.log('  Soil Moisture:', Math.min(...soils), 'to', Math.max(...soils), '%');
        }
        
        if (yieldData.length > 0) {
            const yields = yieldData.map(y => 
                parseFloat(y.harvestYield || y.yieldAmount || y.yield || y.weight || 0)
            ).filter(y => y > 0);
            
            console.log('📊 Yield Data Range:');
            console.log('  Yield:', Math.min(...yields), 'to', Math.max(...yields), 'kg');
            console.log('  Average Yield:', (yields.reduce((a,b) => a+b, 0) / yields.length).toFixed(2), 'kg');
        }
        
        // Check temporal correlation success rate
        const features = this.preprocessData(sensorData, yieldData);
        if (features) {
            const fallbackCount = features.filter(f => f.approach.includes('fallback')).length;
            const successRate = ((features.length - fallbackCount) / features.length * 100).toFixed(1);
            console.log('📊 Temporal Matching Success Rate:', successRate + '%');
            console.log('📊 Using Fallback Approach:', fallbackCount, 'out of', features.length, 'records');
        }
    }
}

// Export singleton instance
const mlModel = new YieldPredictionModel();
export default mlModel;