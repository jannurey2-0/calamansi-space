import { 
    createUserWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

import { db, auth, secondaryAuth } from '../firebase-config.js';
import { 
    doc, 
    setDoc, 
    collection, 
    query, 
    where, 
    onSnapshot, 
    serverTimestamp,
    getDoc,
    getDocs,
   updateDoc,
   deleteDoc
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { initAuthSidebar } from './Auth.js';

const FarmerSDK = {
    subscribeToFarmers: (callback) => {
        console.log('🔍 Querying all users from "users" collection and filtering farmers...');
        const q = query(collection(db, "users"));
        return onSnapshot(q, (snapshot) => {
            console.log('📡 Firestore snapshot received, total docs:', snapshot.docs.length);
            
            // Filter to get farmers (exclude admins and other roles)
            const allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const farmers = allUsers.filter(user => user.role !== 'admin' && user.role !== 'superadmin');
            
            console.log('👥 Filtered farmers (excluding admins):', farmers.length);
            console.log('👥 Farmers data:', farmers);
            
            callback(farmers);
        }, (error) => {
            console.error('❌ Error subscribing to users:', error);
        });

    },

    // Debug function to check all users
    debugAllUsers: async () => {
        console.log('🔍 DEBUG: Checking ALL users in the database...');
        try {
            const snapshot = await getDocs(collection(db, "users"));
            console.log(`📊 Found ${snapshot.docs.length} total users in "users" collection`);
            
            snapshot.docs.forEach((doc, index) => {
                const data = doc.data();
                console.log(`👤 User ${index + 1} (ID: ${doc.id}):`, {
                    email: data.email,
                    role: data.role,
                    firstName: data.firstName,
                    surname: data.surname,
                    status: data.status
                });
            });
            
            // Also show filtered farmers
            const allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const farmers = allUsers.filter(user => user.role !== 'admin' && user.role !== 'superadmin');
            console.log(`👥 Filtered farmers (non-admin users): ${farmers.length}`);
            
        } catch (error) {
            console.error('❌ Error checking users:', error);
        }
    },

    saveFarmer: async (data) => {
        const DEFAULT_PASS = "123456"; 
        try {
            const userCredential = await createUserWithEmailAndPassword(
                secondaryAuth, 
                data.email, 
                DEFAULT_PASS
            );
            const uid = userCredential.user.uid;
            await setDoc(doc(db, "users", uid), {
                ...data,
                role: 'user',
                status: 'Active',
                needsPasswordChange: true,
                createdAt: serverTimestamp()
            });
            await signOut(secondaryAuth);
            return uid;
        } catch (error) {
            throw error;
        }
    },

    updateFarmer: async (uid, updatedData) => {
        try {
            const ref = doc(db, "users", uid);
            await updateDoc(ref, {
                ...updatedData,
                updatedAt: serverTimestamp()
            });
            console.log("✅ Farmer updated:", uid);
        } catch (err) {
            console.error("❌ Update failed:", err);
            throw err;
        }
    }
};

const app = {
    grid: document.getElementById('farmersGrid'),
    form: document.getElementById('addFarmerForm'),
    modal: document.getElementById('addFarmerModal'),
    logoutModal: document.getElementById('logout-modal'),
    searchInput: document.getElementById('searchInput'),
    locFilter: document.getElementById('locationFilter'),
    allFarmers: [],

    init() {
        console.log('🚀 Initializing Farmers App...');
        initAuthSidebar(); // Add this line
        this.setupListeners();
        console.log('📡 Setting up farmers subscription...');
        FarmerSDK.subscribeToFarmers((data) => {
            console.log('📊 Farmers data received:', data.length, 'farmers');
            console.log('📋 Farmers data:', data);
            this.allFarmers = data;
            this.updateStats(data);
            this.updateLocationDropdown(data);
            this.handleFilter();
        });
    },

    updateLocationDropdown(data) {
        if (!this.locFilter) return;
        const locations = [...new Set(data.map(f => f.location).filter(l => l))].sort();
        const currentSelection = this.locFilter.value;
        
        let html = '<option value="All">All Locations</option>';
        locations.forEach(loc => {
            html += `<option value="${loc}">${loc}</option>`;
        });
        
        this.locFilter.innerHTML = html;
        this.locFilter.value = currentSelection;
    },

    switchTab(tab) {
        const pTab = document.getElementById('tab-profile');
        const fTab = document.getElementById('tab-farm');
        const pCont = document.getElementById('content-profile');
        const fCont = document.getElementById('content-farm');

        if (tab === 'profile') {
            pTab.className = "py-4 px-6 text-sm font-bold border-b-2 border-lime-600 text-lime-600 transition";
            fTab.className = "py-4 px-6 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition";
            pCont.classList.remove('hidden');
            fCont.classList.add('hidden');
        } else {
            fTab.className = "py-4 px-6 text-sm font-bold border-b-2 border-lime-600 text-lime-600 transition";
            pTab.className = "py-4 px-6 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition";
            fCont.classList.remove('hidden');
            pCont.classList.add('hidden');
        }
    },

    async openDetailModal(uid) {
        const detailModal = document.getElementById('detailModal');
        detailModal.classList.remove('hidden');
        this.switchTab('profile');
        this.currentEditingUid = uid; 


        try {
            const userSnap = await getDoc(doc(db, "users", uid));
            
            if (userSnap.exists()) {
                const u = userSnap.data();
                document.getElementById('det-photo').src = u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.surname}`;
                document.getElementById('det-title-name').innerText = `${u.firstName} ${u.surname}`;
                document.getElementById('p-fullname').innerText = `${u.firstName} ${u.middleName || ''} ${u.surname} ${u.suffix || ''}`;
                document.getElementById('p-email').innerText = u.email || 'N/A';
                document.getElementById('p-phone').innerText = u.phoneNumber || 'N/A';
                document.getElementById('p-location').innerText = u.location || 'N/A';
                document.getElementById('p-created').innerText = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : 'N/A';
                
                // Update status in both profile section and detail modal header
                const statusValue = u.status || 'Active';
                const statusEl = document.getElementById('p-status');
                statusEl.innerText = statusValue;
                statusEl.className = statusValue.toLowerCase() === 'active'
                    ? 'px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-green-100 text-green-700' 
                    : 'px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-500';
                
                // Update status in the modal header
                const detStatusEl = document.getElementById('det-status');
                detStatusEl.innerText = '';
                detStatusEl.innerHTML = `
                    <i class="fa-solid ${statusValue.toLowerCase() === 'active' ? 'fa-check' : 'fa-moon'}"></i> ${statusValue}
                `;
                detStatusEl.className = statusValue.toLowerCase() === 'active'
                    ? 'px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-700 flex items-center gap-1'
                    : 'px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 flex items-center gap-1';

                const farmQuery = query(collection(db, "Farm_information"), where("Locations", "==", u.location));
                const farmSnapshot = await getDocs(farmQuery);

                if (!farmSnapshot.empty) {
                    const f = farmSnapshot.docs[0].data();
                    document.getElementById('f-locations').innerText = f.Locations || 'N/A';
                    document.getElementById('f-variety').innerText = f.Kalamansi_Variety || 'N/A';
                    document.getElementById('f-age').innerText = f.Tree_Age || 'N/A';
                    document.getElementById('f-prod').innerText = f.AverageProduction || 'N/A';
                    document.getElementById('f-soil').innerText = f.Soil_type || 'N/A';
                    document.getElementById('f-flower').innerText = f.floweringDate || 'N/A';
                    document.getElementById('f-harvest').innerText = f.estimatedHarvest || 'N/A';
                    document.getElementById('f-trees').innerText = f.numberOfTrees || 'N/A';
                    document.getElementById('f-practice').innerText = f.FertilizerPractice || 'N/A';
                    
                    if(document.getElementById('f-size')) document.getElementById('f-size').innerText = f.Farm_size || 'N/A';
                    if(document.getElementById('f-climate')) document.getElementById('f-climate').innerText = f.Climate_Stat || 'N/A';
                    if(document.getElementById('f-irrigation')) document.getElementById('f-irrigation').innerText = f.irrigation_type || 'N/A';
                    if(document.getElementById('f-yield')) document.getElementById('f-yield').innerText = f.currentYield || 'N/A';
                } else {
                    const farmFields = ['f-locations', 'f-variety', 'f-age', 'f-prod', 'f-soil', 'f-flower', 'f-harvest', 'f-trees', 'f-practice'];
                    farmFields.forEach(id => {
                        const el = document.getElementById(id);
                        if(el) el.innerText = "No record Found";
                    });
                }
            }
        } catch (err) {
            console.error(err);
        }
    },

    closeDetailModal() {
        document.getElementById('detailModal').classList.add('hidden');
        this.exitEditMode();
    },

     enterEditMode() {
        const profileContent = document.getElementById('content-profile');
        const editBtn = document.getElementById('edit-profile-btn');
        const saveBtn = document.getElementById('save-profile-btn');
        const cancelBtn = document.getElementById('cancel-profile-btn');

        // Hide static text and show inputs
        document.querySelectorAll('.profile-field').forEach(el => {
            const input = document.getElementById(el.id.replace('p-', 'edit-'));
            if (input) {
                input.value = el.innerText === 'N/A' ? '' : el.innerText;
                el.style.display = 'none';
                input.style.display = 'block';
            }
        });

        // Show save/cancel buttons, hide edit button
        if (editBtn) editBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'inline-block';
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
    },

        exitEditMode() {
        const profileContent = document.getElementById('content-profile');
        const editBtn = document.getElementById('edit-profile-btn');
        const saveBtn = document.getElementById('save-profile-btn');
        const cancelBtn = document.getElementById('cancel-profile-btn');

        // Show static text and hide inputs
        document.querySelectorAll('.profile-field').forEach(el => {
            const input = document.getElementById(el.id.replace('p-', 'edit-'));
            if (input) {
                el.style.display = 'block';
                input.style.display = 'none';
            }
        });

        // Show edit button, hide save/cancel buttons
        if (editBtn) editBtn.style.display = 'inline-block';
        if (saveBtn) saveBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
    },

    async saveProfileChanges() {
        const fullName = document.getElementById('edit-fullname').value.trim();
        const nameParts = fullName.split(' ');
        const firstName = nameParts[0] || '';
        const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';
        const surname = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
        const suffix = ''; // Assuming suffix is not in full name, or parse if needed
      
        const updatedData = {
            firstName,
            middleName,
            surname,
            suffix,
            email: document.getElementById('edit-email').value,
            phoneNumber: document.getElementById('edit-phone').value,
            location: document.getElementById('edit-location').value,
            landSize: parseFloat(document.getElementById('edit-landsize').value) || 0
        };

        try {
            await FarmerSDK.updateFarmer(this.currentEditingUid, updatedData);
            alert('Profile updated successfully!');
           console.log('Updating user with ID:', this.currentEditingUid); 
            this.exitEditMode();
            // Refresh the modal with updated data
            this.openDetailModal(this.currentEditingUid);
            // Update the farmers list
            FarmerSDK.subscribeToFarmers((data) => {
                this.allFarmers = data;
                this.updateStats(data);
                this.handleFilter();
            });
        } catch (err) {
            alert('Error updating profile: ' + err.message);
             console.log('Updating user with ID:', this.currentEditingUid); 
        }
    },

    setupListeners() {
        this.searchInput.addEventListener('input', () => this.handleFilter());
        this.locFilter.addEventListener('change', () => this.handleFilter());

        this.form.onsubmit = async (e) => {
            e.preventDefault();
            const submitBtn = this.form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.innerText = "Registering...";

            const farmerData = {
                firstName: document.getElementById('firstNameform').value,
                surname: document.getElementById('surnameform').value,
                suffix: document.getElementById('suffixform').value,
                location: document.getElementById('fLocationform').value,
                landSize: parseFloat(document.getElementById('fHectaresform').value),
                email: document.getElementById('emailform').value,
                phoneNumber: document.getElementById('fPhoneform').value
            };

            try {
                await FarmerSDK.saveFarmer(farmerData);
                this.closeModal();
                this.form.reset();
                alert("Farmer Registered Successfully!\nDefault Password: 123456");
            } catch (err) {
                alert("Error: " + err.message);
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerText = "Register";
            }
        };

        const sidebarLogoutBtn = document.querySelector('.fa-right-from-bracket').parentElement;
        sidebarLogoutBtn.onclick = (e) => {
            e.preventDefault();
            this.openLogout();
        };

        document.getElementById('btn-cancel-logout').onclick = () => this.closeLogout();
        document.getElementById('btn-confirm-logout').onclick = () => {
            signOut(auth).then(() => window.location.href = 'index.html');
        };
    },

    handleFilter() {
        const term = this.searchInput.value.toLowerCase();
        const loc = this.locFilter.value;
        const filtered = this.allFarmers.filter(f => {
            const fullName = `${f.firstName} ${f.surname}`.toLowerCase();
            const matchesSearch = fullName.includes(term);
            const matchesLoc = loc === "All" || f.location === loc;
            return matchesSearch && matchesLoc;
        });
        this.render(filtered);
    },

    updateStats(data) {
        const totalHa = data.reduce((sum, f) => sum + (f.landSize || 0), 0);
        const stats = document.querySelectorAll('h3.text-xl.font-bold');
        if (stats.length >= 2) {
            stats[0].innerText = data.length;
            stats[1].innerText = `${totalHa.toFixed(1)} ha`;
        }
    },

    openModal() { this.modal.classList.remove('hidden'); },
    closeModal() { this.modal.classList.add('hidden'); },

    openLogout() {
        this.logoutModal.classList.remove('hidden');
        const backdrop = document.getElementById('logout-backdrop');
        const panel = document.getElementById('logout-panel');
        setTimeout(() => {
            backdrop.classList.replace('opacity-0', 'opacity-100');
            panel.classList.replace('opacity-0', 'opacity-100');
            panel.classList.replace('translate-y-4', 'translate-y-0');
        }, 10);
    },

    closeLogout() {
        const backdrop = document.getElementById('logout-backdrop');
        const panel = document.getElementById('logout-panel');
        backdrop.classList.replace('opacity-100', 'opacity-0');
        panel.classList.replace('opacity-100', 'opacity-0');
        panel.classList.replace('translate-y-0', 'translate-y-4');
        setTimeout(() => this.logoutModal.classList.add('hidden'), 300);
    },

    showAccountOptions(event, farmerId, firstName, surname) {
        const menu = document.getElementById('accountActionsMenu');
        const setStatusBtn = document.getElementById('setStatusBtn');
        const statusActionText = document.getElementById('statusActionText');
        const deleteAccountBtn = document.getElementById('deleteAccountBtn');
        
        // Get the farmer's current status
        const farmer = this.allFarmers.find(f => f.id === farmerId);
        const currentStatus = farmer?.status || 'Active';
        
        // Set the button text based on current status
        if (currentStatus.toLowerCase() === 'active') {
            statusActionText.textContent = 'Set Inactive';
        } else {
            statusActionText.textContent = 'Set Active';
        }
        
        // Position the menu near the clicked button
        const rect = event.target.getBoundingClientRect();
        menu.style.top = `${rect.bottom + window.scrollY}px`;
        menu.style.left = `${rect.left + window.scrollX - 120}px`;
        
        // Show the menu
        menu.classList.remove('hidden');
        
        // Set up event handler for the status button
        setStatusBtn.onclick = () => {
            if (currentStatus.toLowerCase() === 'active') {
                this.setFarmerInactive(farmerId, firstName, surname);
            } else {
                this.setFarmerActive(farmerId, firstName, surname);
            }
        };
        
        deleteAccountBtn.onclick = () => this.deleteFarmerAccount(farmerId, firstName, surname);
        
        // Close menu when clicking elsewhere
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !event.target.contains(e.target)) {
                menu.classList.add('hidden');
                document.removeEventListener('click', closeMenu);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 10);
    },

    async setFarmerInactive(farmerId, firstName, surname) {
        if (!confirm(`Are you sure you want to set ${firstName} ${surname}'s account as inactive?`)) {
            document.getElementById('accountActionsMenu').classList.add('hidden');
            return;
        }
        
        try {
            // Update the farmer's status to inactive
            await FarmerSDK.updateFarmer(farmerId, { status: 'Inactive' });
            
            alert(`${firstName} ${surname}'s account has been set to inactive.`);
            
            // Refresh the farmers list
            FarmerSDK.subscribeToFarmers((data) => {
                this.allFarmers = data;
                this.updateStats(data);
                this.handleFilter();
            });
        } catch (error) {
            console.error('Error setting farmer inactive:', error);
            alert('Error setting farmer as inactive: ' + error.message);
        }
        
        document.getElementById('accountActionsMenu').classList.add('hidden');
    },

    async setFarmerActive(farmerId, firstName, surname) {
        if (!confirm(`Are you sure you want to set ${firstName} ${surname}'s account as active?`)) {
            document.getElementById('accountActionsMenu').classList.add('hidden');
            return;
        }
        
        try {
            // Update the farmer's status to active
            await FarmerSDK.updateFarmer(farmerId, { status: 'Active' });
            
            alert(`${firstName} ${surname}'s account has been set to active.`);
            
            // Refresh the farmers list
            FarmerSDK.subscribeToFarmers((data) => {
                this.allFarmers = data;
                this.updateStats(data);
                this.handleFilter();
            });
        } catch (error) {
            console.error('Error setting farmer active:', error);
            alert('Error setting farmer as active: ' + error.message);
        }
        
        document.getElementById('accountActionsMenu').classList.add('hidden');
    },

    async deleteFarmerAccount(farmerId, firstName, surname) {
        if (!confirm(`⚠️ WARNING: Are you sure you want to permanently delete ${firstName} ${surname}'s account? This action cannot be undone and will remove all associated data.`)) {
            document.getElementById('accountActionsMenu').classList.add('hidden');
            return;
        }
        
        try {
            // Delete the user document from Firestore
            await this.deleteFarmerFromDatabase(farmerId);
            
            alert(`${firstName} ${surname}'s account has been permanently deleted.`);
            
            // Refresh the farmers list
            FarmerSDK.subscribeToFarmers((data) => {
                this.allFarmers = data;
                this.updateStats(data);
                this.handleFilter();
            });
        } catch (error) {
            console.error('Error deleting farmer account:', error);
            alert('Error deleting farmer account: ' + error.message);
        }
        
        document.getElementById('accountActionsMenu').classList.add('hidden');
    },

    async deleteFarmerFromDatabase(farmerId) {
        // Delete the user document from the users collection
        await deleteDoc(doc(db, "users", farmerId));
    },

    render(data) {
        this.grid.innerHTML = '';
        if (data.length === 0) {
            const isSearching = this.searchInput.value !== "" || this.locFilter.value !== "All";
            this.grid.innerHTML = `
                <div class="col-span-full flex flex-col items-center justify-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-100">
                    <div class="w-20 h-20 bg-lime-50 rounded-full flex items-center justify-center mb-4">
                        <i class="fa-solid ${isSearching ? 'fa-magnifying-glass' : 'fa-seedling'} text-3xl text-lime-600/50"></i>
                    </div>
                    <h3 class="text-lg font-bold text-slate-700">
                        ${isSearching ? 'No matching farmers found' : 'No farmers added yet'}
                    </h3>
                    <p class="text-slate-500 text-sm max-w-xs text-center mt-1">
                        ${isSearching ? 'Try clearing your search or filters.' : 'Start by registering a new farmer.'}
                    </p>
                </div>
                <div class="mt-5 flex gap-2">
                    <button class="view-btn flex-1 border border-slate-200 hover:border-lime-500 hover:text-lime-600 text-slate-600 py-2 rounded-lg text-sm font-medium transition">
                        View
                    </button>
                    <button class="edit-btn flex-1 bg-lime-600 hover:bg-lime-700 text-white py-2 rounded-lg text-sm font-medium transition">
                        Edit
                    </button>
                </div>

            `;
            return;
        }

        data.forEach(f => {
            let statusClass = (!f.status || f.status.toLowerCase() === 'active') ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500';
            let statusIcon = (!f.status || f.status.toLowerCase() === 'active') ? 'fa-check' : 'fa-moon';
            const card = document.createElement('div');
            card.className = 'bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition group overflow-hidden relative';
            card.innerHTML = `
                <div class="h-20 bg-gradient-to-r from-lime-600 to-lime-500"></div>
                <div class="px-6 pb-6 relative">
                    <div class="w-16 h-16 rounded-full border-4 border-white bg-white absolute -top-8 overflow-hidden shadow-sm">
                        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${f.surname}" alt="${f.firstName}" class="w-full h-full">
                    </div>
                    <div class="flex justify-end pt-2 mb-2">
                        <button class="account-options-btn w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition" data-farmer-id="${f.id}" title="Account Options">
                            <i class="fa-solid fa-ellipsis"></i>
                        </button>
                    </div>
                    <div class="mt-2">
                        <h3 class="font-bold text-slate-800 text-lg leading-tight">${f.firstName} ${f.surname}</h3>
                        <p class="text-sm text-slate-500 flex items-center gap-1 mt-1">
                            <i class="fa-solid fa-location-dot text-lime-600 text-xs"></i> ${f.location}
                        </p>
                    </div>
                    <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
                        <div class="bg-slate-50 p-2 rounded-lg border border-slate-100">
                            <p class="text-xs text-slate-400 uppercase font-bold">Land Size</p>
                            <p class="font-semibold text-slate-700">${f.landSize} ha</p>
                        </div>
                        <div class="bg-slate-50 p-2 rounded-lg border border-slate-100">
                            <p class="text-xs text-slate-400 uppercase font-bold">Role</p>
                            <p class="font-semibold text-lime-600 capitalize">${f.role}</p>
                        </div>
                    </div>
                    <div class="mt-5 flex gap-2">
                        <button class="view-btn flex-1 border border-slate-200 hover:border-lime-500 hover:text-lime-600 text-slate-600 py-2 rounded-lg text-sm font-medium transition">
                            View Profile
                        </button>
                    </div>
                </div>
            `;
            card.querySelector('.view-btn').onclick = () => this.openDetailModal(f.id);
            
            // Add event listener for the account options button
            const optionsBtn = card.querySelector('.account-options-btn');
            optionsBtn.onclick = (e) => {
                e.stopPropagation();
                this.showAccountOptions(e, f.id, f.firstName, f.surname);
            };
            
            this.grid.appendChild(card);
        });
    }
};

window.app = app;
window.debugFarmers = () => FarmerSDK.debugAllUsers();
document.addEventListener('DOMContentLoaded', () => app.init());