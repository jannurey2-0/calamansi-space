import { SensorDashboardBase } from './sensor-core.js';
import { initAuthSidebar } from './Auth.js';

class AdminDashboardApp extends SensorDashboardBase {
    constructor() {
        super('calamansi_admin');
        initAuthSidebar();
        this.init();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AdminDashboardApp();
});
