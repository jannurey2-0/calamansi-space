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

class BalancedDataGenerator {
    constructor() {
        this.optimalConditions = {
            temperature: { min: 22, max: 30, ideal: 26 },
            humidity: { min: 60, max: 80, ideal: 70 },
            soilMoisture: { min: 25, max: 45, ideal: 35 }
        };
    }

    // Generate realistic sensor data with balanced conditions
    async generateBalancedSensorData(days = 90, recordsPerDay = 8) {
        console.log(`📊 Generating ${days * recordsPerDay} balanced sensor records...`);
        
        const sensorData = [];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        // Define different condition types for balanced data
        const conditionTypes = [
            { name: 'optimal', weight: 0.4 },   // 40% optimal conditions
            { name: 'good', weight: 0.3 },      // 30% good conditions
            { name: 'moderate', weight: 0.2 },  // 20% moderate conditions  
            { name: 'challenging', weight: 0.1 } // 10% challenging conditions
        ];
        
        for (let day = 0; day < days; day++) {
            for (let record = 0; record < recordsPerDay; record++) {
                const timestamp = new Date(startDate);
                timestamp.setDate(startDate.getDate() + day);
                timestamp.setHours(Math.floor(record * (24 / recordsPerDay)));
                
                // Randomly select condition type based on weights
                const rand = Math.random();
                let selectedType = conditionTypes[0];
                let cumulativeWeight = 0;
                for (const type of conditionTypes) {
                    cumulativeWeight += type.weight;
                    if (rand <= cumulativeWeight) {
                        selectedType = type;
                        break;
                    }
                }
                
                // Generate conditions based on selected type
                let temp, humidity, soilMoisture;
                
                switch(selectedType.name) {
                    case 'optimal':
                        // Close to ideal values with small variations
                        temp = this.optimalConditions.temperature.ideal + this.generateVariation(-2, 2);
                        humidity = this.optimalConditions.humidity.ideal + this.generateVariation(-5, 5);
                        soilMoisture = this.optimalConditions.soilMoisture.ideal + this.generateVariation(-3, 3);
                        break;
                        
                    case 'good':
                        // Good but not perfect conditions
                        temp = this.optimalConditions.temperature.ideal + this.generateVariation(-4, 4);
                        humidity = this.optimalConditions.humidity.ideal + this.generateVariation(-8, 8);
                        soilMoisture = this.optimalConditions.soilMoisture.ideal + this.generateVariation(-5, 5);
                        break;
                        
                    case 'moderate':
                        // More variation from optimal
                        temp = this.optimalConditions.temperature.ideal + this.generateVariation(-6, 6);
                        humidity = this.optimalConditions.humidity.ideal + this.generateVariation(-12, 12);
                        soilMoisture = this.optimalConditions.soilMoisture.ideal + this.generateVariation(-7, 7);
                        break;
                        
                    case 'challenging':
                        // Conditions further from optimal
                        temp = this.optimalConditions.temperature.ideal + this.generateVariation(-8, 8);
                        humidity = this.optimalConditions.humidity.ideal + this.generateVariation(-15, 15);
                        soilMoisture = this.optimalConditions.soilMoisture.ideal + this.generateVariation(-10, 10);
                        break;
                }
                
                // Ensure values stay within reasonable bounds
                temp = Math.max(15, Math.min(40, temp));
                humidity = Math.max(30, Math.min(95, humidity));
                soilMoisture = Math.max(10, Math.min(70, soilMoisture));
                
                const data = {
                    temperature: temp,
                    humidity: humidity,
                    avgSoilMoisture: soilMoisture,
                    timestamp: timestamp
                };
                
                sensorData.push(data);
            }
        }
        
        // Save to Firestore using batch writes
        try {
            console.log('💾 Saving balanced sensor data to Firestore (batch mode)...');
            
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
                console.log(`✅ Saved ${totalSaved}/${sensorData.length} balanced sensor records...`);
            }
            
            console.log(`✅ Generated and saved ${totalSaved} balanced sensor records`);
            return totalSaved;
        } catch (error) {
            console.error('❌ Error saving balanced sensor data:', error);
            return 0;
        }
    }

    // Generate balanced yield history data
    async generateBalancedYieldHistory(count = 20) {
        console.log(`🌾 Generating ${count} balanced yield history records...`);
        
        const yieldData = [];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 210); // Start 7 months ago
        
        // Farmer profiles with realistic data
        const farmers = [
            { name: 'Juan Dela Cruz', farm: 'Green Valley Farm', location: 'Region 3' },
            { name: 'Maria Santos', farm: 'Sunrise Orchards', location: 'Region 4-A' },
            { name: 'Pedro Garcia', farm: 'Mountain View Plantation', location: 'CAR' },
            { name: 'Ana Reyes', farm: 'Coastal Gardens', location: 'Region 6' },
            { name: 'Carlos Mendoza', farm: 'Riverbank Farms', location: 'Region 10' }
        ];
        
        // Define yield ranges based on environmental conditions
        const conditionRanges = [
            { condition: 'optimal', yieldMin: 12, yieldMax: 18, quality: 'Grade A', prob: 0.3 },    // 30% chance of optimal
            { condition: 'good', yieldMin: 8, yieldMax: 14, quality: 'Grade B', prob: 0.4 },       // 40% chance of good
            { condition: 'moderate', yieldMin: 5, yieldMax: 10, quality: 'Grade B', prob: 0.2 },   // 20% chance of moderate
            { condition: 'poor', yieldMin: 3, yieldMax: 7, quality: 'Grade C', prob: 0.1 }         // 10% chance of poor
        ];
        
        for (let i = 0; i < count; i++) {
            const harvestDate = new Date(startDate);
            harvestDate.setDate(startDate.getDate() + (i * 10)); // Every 10 days
            
            // Select condition type based on probabilities
            const rand = Math.random();
            let selectedCondition = conditionRanges[0];
            let cumulativeProb = 0;
            for (const cond of conditionRanges) {
                cumulativeProb += cond.prob;
                if (rand <= cumulativeProb) {
                    selectedCondition = cond;
                    break;
                }
            }
            
            // Select farmer (rotate through list)
            const farmer = farmers[i % farmers.length];
            
            // Generate yield based on selected condition
            const yieldAmount = this.generateVariation(
                selectedCondition.yieldMin, 
                selectedCondition.yieldMax
            );
            
            // Generate realistic batch information
            const batchId = `CY-${harvestDate.getFullYear()}-${String(harvestDate.getMonth() + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
            
            const data = {
                // Farmer Information
                FarmerName: farmer.name,
                farmName: farmer.farm,
                location: farmer.location,
                
                // Harvest Details
                batch_id: batchId,
                batchId: batchId,
                harvestDate: harvestDate,
                date: harvestDate,
                harvestYield: Math.max(2, yieldAmount), // Minimum 2kg realistic
                yieldAmount: Math.max(2, yieldAmount),
                
                // Quality Information
                quality: selectedCondition.quality,
                grade: selectedCondition.quality,
                
                // Environmental Context
                weather: this.getRandomWeather(),
                season: this.getSeason(harvestDate),
                
                // Status and Notes
                status: 'approved',
                state: 'approved',
                Inspector_notes: `Harvested under ${selectedCondition.quality.toLowerCase()} conditions. ${this.getRandomWeather()} weather during harvest.`,
                notes: `Good ${selectedCondition.quality.toLowerCase()} quality harvest. Proper ripeness timing.`,
                
                // Additional metadata
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            yieldData.push(data);
        }
        
        // Save to Firestore using batch writes
        try {
            console.log('💾 Saving balanced yield history data to Firestore (batch mode)...');
            
            const batch = writeBatch(db);
            const savedRecords = [];
            
            yieldData.forEach(data => {
                const docRef = doc(collection(db, 'farm_history'));
                batch.set(docRef, data);
                savedRecords.push({ id: docRef.id, ...data });
            });
            
            await batch.commit();
            console.log(`✅ Generated and saved ${savedRecords.length} balanced yield history records`);
            
            // Log sample of generated data
            console.log('📊 Sample generated records:');
            savedRecords.slice(0, 3).forEach((record, index) => {
                console.log(`${index + 1}. ${record.FarmerName} - ${record.harvestYield}kg (${record.quality}) on ${record.harvestDate.toLocaleDateString()}`);
            });
            
            return savedRecords.length;
        } catch (error) {
            console.error('❌ Error saving balanced yield data:', error);
            return 0;
        }
    }

    // Generate variation within range
    generateVariation(min, max) {
        return Math.random() * (max - min) + min;
    }

    // Get random weather condition
    getRandomWeather() {
        const weatherConditions = ['Sunny', 'Partly Cloudy', 'Overcast', 'Light Rain', 'Cloudy'];
        return weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
    }

    // Get season based on date
    getSeason(date) {
        const month = date.getMonth() + 1;
        if (month >= 3 && month <= 5) return 'Dry Season (Early)';
        if (month >= 6 && month <= 8) return 'Wet Season (Early)';
        if (month >= 9 && month <= 11) return 'Wet Season (Late)';
        return 'Dry Season (Late)';
    }

    // Generate balanced training dataset
    async generateBalancedTrainingDataset() {
        console.log('🚀 Generating balanced training dataset...');
        
        const sensorCount = await this.generateBalancedSensorData(90, 8); // 90 days, 8 records/day
        const yieldCount = await this.generateBalancedYieldHistory(20); // 20 balanced yield records
        
        console.log(`📊 Balanced Training Dataset Summary:`);
        console.log(`   - Sensor Records: ${sensorCount} (balanced environmental data)`);
        console.log(`   - Yield Records: ${yieldCount} (balanced yield outcomes)`);
        console.log(`✅ Balanced training dataset generation complete!`);
        
        return {
            sensorRecords: sensorCount,
            yieldRecords: yieldCount
        };
    }
}

// Export the generator
const balancedDataGenerator = new BalancedDataGenerator();

// Global functions for easy access
window.generateBalancedTrainingData = async () => {
    console.log('🤖 Starting balanced ML training data generation...');
    return await balancedDataGenerator.generateBalancedTrainingDataset();
};

window.generateBalancedSensorData = async (days = 90, recordsPerDay = 8) => {
    return await balancedDataGenerator.generateBalancedSensorData(days, recordsPerDay);
};

window.generateBalancedYieldHistory = async (count = 20) => {
    return await balancedDataGenerator.generateBalancedYieldHistory(count);
};

export default balancedDataGenerator;