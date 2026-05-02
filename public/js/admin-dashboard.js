import { SensorDashboardBase } from './sensor-core.js';
import { initAuthSidebar } from './Auth.js';

class AdminDashboardApp extends SensorDashboardBase {
    constructor() {
        super('calamansi_admin');
        initAuthSidebar();
        this.init();
    }

    async init() {
        await super.init();
        
        // For admin dashboard, ensure we have some data for demonstration
        setTimeout(() => {
            if (!this.latestReadings) {
                console.log('🔧 Admin dashboard: No sensor data received, using demo data');
                const demoData = {
                    temperature: 26,
                    humidity: 70,
                    avgSoilMoisture: 35,
                    timestamp: new Date()
                };
                this.updateCardsAndAI(demoData, false);
            }
        }, 3000); // Wait 3 seconds for real data
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AdminDashboardApp();
});
