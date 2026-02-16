import { app } from '../firebase-config.js';
import { 
    getFirestore, 
    collection, 
    addDoc,
    doc,
    writeBatch,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

const db = getFirestore(app);

// ------------------------------------------------------------------
// SAMPLE DATA GENERATION FOR TESTING
// ------------------------------------------------------------------

class SampleDataGenerator {
    constructor() {
        this.optimalConditions = {
            temperature: { min: 22, max: 30, ideal: 26 },
            humidity: { min: 60, max: 80, ideal: 70 },
            soilMoisture: { min: 25, max: 45, ideal: 35 }
        };
    }

    // Generate realistic sensor data
    async generateSensorData(days = 30, recordsPerDay = 24) {
        console.log(`📊 Generating ${days * recordsPerDay} sensor records...`);
        
        const sensorData = [];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        for (let day = 0; day < days; day++) {
            for (let record = 0; record < recordsPerDay; record++) {
                const timestamp = new Date(startDate);
                timestamp.setDate(startDate.getDate() + day);
                timestamp.setHours(Math.floor(record * (24 / recordsPerDay)));
                
                // Generate realistic variations around optimal conditions
                const tempVariation = this.generateVariation(-3, 3);
                const humVariation = this.generateVariation(-10, 10);
                const soilVariation = this.generateVariation(-8, 8);
                
                const data = {
                    temperature: this.optimalConditions.temperature.ideal + tempVariation,
                    humidity: this.optimalConditions.humidity.ideal + humVariation,
                    avgSoilMoisture: this.optimalConditions.soilMoisture.ideal + soilVariation,
                    timestamp: timestamp
                };
                
                sensorData.push(data);
            }
        }
        
        // Save to Firestore using batch writes for better performance
        try {
            console.log('💾 Saving sensor data to Firestore (batch mode)...');
            
            // Process in batches of 100 to avoid Firestore limits
            const batchSize = 100;
            let totalSaved = 0;
            
            for (let i = 0; i < sensorData.length; i += batchSize) {
                const batch = writeBatch(db);
                const batchData = sensorData.slice(i, i + batchSize);
                
                batchData.forEach(data => {
                    const docRef = doc(collection(db, 'dataCollectionSensor'));
                    batch.set(docRef, {
                        temperature: data.temperature,
                        humidity: data.humidity,
                        avgSoilMoisture: data.avgSoilMoisture,
                        timestamp: data.timestamp
                    });
                });
                
                await batch.commit();
                totalSaved += batchData.length;
                console.log(`✅ Saved ${totalSaved}/${sensorData.length} sensor records...`);
            }
            
            console.log(`✅ Generated and saved ${totalSaved} sensor records`);
            return totalSaved;
        } catch (error) {
            console.warn('⚠️ Batch write failed, falling back to individual writes...', error);
            
            // Fallback to individual writes
            try {
                console.log('💾 Using fallback individual write mode...');
                let savedCount = 0;
                
                for (const data of sensorData) {
                    await addDoc(collection(db, 'dataCollectionSensor'), {
                        temperature: data.temperature,
                        humidity: data.humidity,
                        avgSoilMoisture: data.avgSoilMoisture,
                        timestamp: data.timestamp
                    });
                    savedCount++;
                    if (savedCount % 50 === 0) {
                        console.log(`✅ Saved ${savedCount}/${sensorData.length} sensor records...`);
                    }
                }
                
                console.log(`✅ Generated and saved ${savedCount} sensor records (fallback mode)`);
                return savedCount;
            } catch (fallbackError) {
                console.error('❌ Error in fallback mode:', fallbackError);
                return 0;
            }
        }
    }

    // Generate comprehensive yield history records
    async generateYieldHistory(count = 15) {
        console.log(`🌾 Generating ${count} yield history records...`);
        
        const yieldData = [];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 200); // ~7 months ago for good training data
        
        // Farmer profiles with realistic data
        const farmers = [
            { name: 'Juan Dela Cruz', farm: 'Green Valley Farm', location: 'Region 3' },
            { name: 'Maria Santos', farm: 'Sunrise Orchards', location: 'Region 4-A' },
            { name: 'Pedro Garcia', farm: 'Mountain View Plantation', location: 'CAR' },
            { name: 'Ana Reyes', farm: 'Coastal Gardens', location: 'Region 6' },
            { name: 'Carlos Mendoza', farm: 'Riverbank Farms', location: 'Region 10' }
        ];
        
        const qualities = ['Grade A', 'Grade B', 'Grade C'];
        const weatherConditions = ['Sunny', 'Partly Cloudy', 'Overcast', 'Light Rain'];
        
        for (let i = 0; i < count; i++) {
            const harvestDate = new Date(startDate);
            harvestDate.setDate(startDate.getDate() + (i * 12)); // Every 12 days for good coverage
            
            // Select farmer (rotate through list)
            const farmer = farmers[i % farmers.length];
            
            // Generate realistic yield based on quality and conditions
            const qualityIndex = Math.floor(Math.random() * qualities.length);
            const quality = qualities[qualityIndex];
            
            // Base yields: A=12-18kg, B=8-14kg, C=4-10kg
            const baseYield = 12 - (qualityIndex * 4);
            const yieldAmount = baseYield + this.generateVariation(-2, 4);
            
            // Generate realistic batch information
            const batchId = `CY-${harvestDate.getFullYear()}-${String(harvestDate.getMonth() + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
            
            const data = {
                // Farmer Information
                FarmerName: farmer.name,
                farmName: farmer.farm,
                location: farmer.location,
                
                // Harvest Details
                batch_id: batchId,
                batchId: batchId, // Alternative field name
                harvestDate: harvestDate,
                date: harvestDate, // Alternative field name
                harvestYield: Math.max(3, yieldAmount), // Minimum 3kg realistic
                yieldAmount: Math.max(3, yieldAmount), // Alternative field name
                
                // Quality Information
                quality: quality,
                grade: quality, // Alternative field name
                
                // Environmental Context
                weather: weatherConditions[Math.floor(Math.random() * weatherConditions.length)],
                season: this.getSeason(harvestDate),
                
                // Status and Notes
                status: 'approved',
                state: 'approved', // Alternative field name
                Inspector_notes: `Harvested under ${quality.toLowerCase()} conditions. ${weatherConditions[Math.floor(Math.random() * weatherConditions.length)]} weather during harvest.`,
                notes: `Good ${quality.toLowerCase()} quality harvest. Proper ripeness timing.`,
                
                // Additional metadata
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            yieldData.push(data);
        }
        
        // Save to Firestore using batch writes for better performance
        try {
            console.log('💾 Saving yield history data to Firestore (batch mode)...');
            
            const batch = writeBatch(db);
            const savedRecords = [];
            
            yieldData.forEach(data => {
                const docRef = doc(collection(db, 'farm_history'));
                batch.set(docRef, data);
                savedRecords.push({ id: docRef.id, ...data });
            });
            
            await batch.commit();
            console.log(`✅ Generated and saved ${savedRecords.length} yield history records`);
            
            // Log sample of generated data
            console.log('📊 Sample generated records:');
            savedRecords.slice(0, 3).forEach((record, index) => {
                console.log(`${index + 1}. ${record.FarmerName} - ${record.harvestYield}kg (${record.quality}) on ${record.harvestDate.toLocaleDateString()}`);
            });
            
            return savedRecords.length;
        } catch (error) {
            console.warn('⚠️ Batch write failed for yield data, falling back to individual writes...', error);
            
            // Fallback to individual writes
            try {
                console.log('💾 Using fallback individual write mode for yield data...');
                const savedRecords = [];
                
                for (const data of yieldData) {
                    const docRef = await addDoc(collection(db, 'farm_history'), data);
                    savedRecords.push({ id: docRef.id, ...data });
                }
                
                console.log(`✅ Generated and saved ${savedRecords.length} yield history records (fallback mode)`);
                
                // Log sample of generated data
                console.log('📊 Sample generated records:');
                savedRecords.slice(0, 3).forEach((record, index) => {
                    console.log(`${index + 1}. ${record.FarmerName} - ${record.harvestYield}kg (${record.quality}) on ${record.harvestDate.toLocaleDateString()}`);
                });
                
                return savedRecords.length;
            } catch (fallbackError) {
                console.error('❌ Error in fallback mode for yield data:', fallbackError);
                return 0;
            }
        }
    }

    // Generate variation within range
    generateVariation(min, max) {
        return Math.random() * (max - min) + min;
    }

    // Get season based on date
    getSeason(date) {
        const month = date.getMonth() + 1;
        if (month >= 3 && month <= 5) return 'Dry Season (Early)';
        if (month >= 6 && month <= 8) return 'Wet Season (Early)';
        if (month >= 9 && month <= 11) return 'Wet Season (Late)';
        return 'Dry Season (Late)';
    }

    // Generate comprehensive training dataset
    async generateTrainingDataset() {
        console.log('🚀 Generating comprehensive training dataset...');
        
        const sensorCount = await this.generateSensorData(90, 8); // 90 days, 8 records/day (every 3 hours)
        const yieldCount = await this.generateYieldHistory(20); // 20 comprehensive yield records
        
        console.log(`📊 Training Dataset Summary:`);
        console.log(`   - Sensor Records: ${sensorCount} (3 months of environmental data)`);
        console.log(`   - Yield Records: ${yieldCount} (varied quality and conditions)`);
        console.log(`✅ Training dataset generation complete! Ready for ML model training.`);
        
        return {
            sensorRecords: sensorCount,
            yieldRecords: yieldCount
        };
    }

    // Clear existing test data (useful for clean testing)
    async clearTestData() {
        console.log('🧹 Clearing test data...');
        // Note: In production, you'd want to be more careful about this
        // For now, we'll just generate new data which will be newer timestamps
        console.log('✅ Ready for new data generation');
    }
}

// Export utility functions
const dataGenerator = new SampleDataGenerator();

// Global functions for console access
window.generateTrainingData = async () => {
    console.log('🤖 Starting ML training data generation...');
    return await dataGenerator.generateTrainingDataset();
};

window.generateTestData = async () => {
    console.log('🧪 Starting test data generation...');
    return await dataGenerator.generateTrainingDataset();
};

window.generateSensorData = async (days = 30, recordsPerDay = 24) => {
    return await dataGenerator.generateSensorData(days, recordsPerDay);
};

window.generateYieldHistory = async (count = 15) => {
    return await dataGenerator.generateYieldHistory(count);
};

window.generateYieldData = async (count = 15) => {
    return await dataGenerator.generateYieldHistory(count);
};

export default dataGenerator;