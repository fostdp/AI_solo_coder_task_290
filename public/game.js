class AirportSimulator {
    constructor() {
        this.ws = null;
        this.playerRole = null;
        this.isHost = false;
        
        this.score = 0;
        this.delayCount = 0;
        this.planesHandled = 0;
        this.isRunning = false;
        this.isPaused = false;
        this.gameTime = 0;
        this.selectedPlane = null;
        this.selectedVehicle = null;
        
        this.departureQueue = [];
        this.arrivalQueue = [];
        this.activePlanes = [];
        
        this.groundVehicles = [
            { id: 1, type: 'deice', name: '除冰车 1', status: 'idle', location: null, processingTime: 0 },
            { id: 2, type: 'tug', name: '拖车 1', status: 'idle', location: null, processingTime: 0 },
            { id: 3, type: 'fuel', name: '加油车 1', status: 'idle', location: null, processingTime: 0 }
        ];
        
        this.weather = { type: 'clear', intensity: 0, remaining: 0 };
        
        this.runways = {
            runway1: { occupied: false, closed: false, plane: null },
            runway2: { occupied: false, closed: false, plane: null }
        };
        this.taxiways = {
            taxiway1: { occupied: false, plane: null }
        };
        
        this.planeIdCounter = 0;
        this.gameLoop = null;
        this.spawnInterval = null;
        this.weatherInterval = null;
        
        this.initElements();
        this.initEventListeners();
        this.connectWebSocket();
    }
    
    initElements() {
        this.scoreEl = document.getElementById('score');
        this.delayEl = document.getElementById('delay');
        this.handledEl = document.getElementById('handled');
        this.startBtn = document.getElementById('startBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.recordsBtn = document.getElementById('recordsBtn');
        this.roleApproachBtn = document.getElementById('roleApproach');
        this.roleTowerBtn = document.getElementById('roleTower');
        this.connStatusEl = document.getElementById('connStatus');
        this.weatherDisplayEl = document.getElementById('weatherDisplay');
        this.weatherIconEl = document.getElementById('weatherIcon');
        this.weatherTextEl = document.getElementById('weatherText');
        this.departureListEl = document.getElementById('departureList');
        this.arrivalListEl = document.getElementById('arrivalList');
        this.vehicleListEl = document.getElementById('vehicleList');
        this.airportEl = document.getElementById('airport');
        this.recordsModal = document.getElementById('recordsModal');
        this.gameOverModal = document.getElementById('gameOverModal');
        this.recordsListEl = document.getElementById('recordsList');
        this.finalScoreEl = document.getElementById('finalScore');
        this.finalHandledEl = document.getElementById('finalHandled');
        this.finalDelayEl = document.getElementById('finalDelay');
        this.saveRecordBtn = document.getElementById('saveRecordBtn');
        this.restartBtn = document.getElementById('restartBtn');
    }
    
    initEventListeners() {
        this.startBtn.addEventListener('click', () => this.startGame());
        this.pauseBtn.addEventListener('click', () => this.togglePause());
        this.recordsBtn.addEventListener('click', () => this.showRecords());
        this.saveRecordBtn.addEventListener('click', () => this.saveRecord());
        this.restartBtn.addEventListener('click', () => this.restartGame());
        
        this.roleApproachBtn.addEventListener('click', () => this.selectRole('approach'));
        this.roleTowerBtn.addEventListener('click', () => this.selectRole('tower'));
        
        document.querySelector('.close').addEventListener('click', () => {
            this.recordsModal.style.display = 'none';
        });
        
        document.getElementById('runway1').addEventListener('click', () => this.assignToRunway('runway1'));
        document.getElementById('runway2').addEventListener('click', () => this.assignToRunway('runway2'));
        document.getElementById('taxiway1').addEventListener('click', () => this.assignToTaxiway('taxiway1'));
        
        window.addEventListener('click', (e) => {
            if (e.target === this.recordsModal) {
                this.recordsModal.style.display = 'none';
            }
        });
    }
    
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            this.connStatusEl.innerHTML = '🟢 已连接';
            console.log('WebSocket连接成功');
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleServerMessage(data);
            } catch (e) {
                console.error('消息解析错误:', e);
            }
        };
        
        this.ws.onclose = () => {
            this.connStatusEl.innerHTML = '🔴 断开连接';
            console.log('WebSocket连接断开');
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
        };
    }
    
    sendMessage(type, data = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, ...data }));
        }
    }
    
    handleServerMessage(data) {
        if (data.type === 'state') {
            this.updateFromServerState(data.data);
        }
    }
    
    updateFromServerState(state) {
        if (state.planes) {
            this.departureQueue = state.planes.departure || [];
            this.arrivalQueue = state.planes.arrival || [];
            this.activePlanes = state.planes.active || [];
        }
        if (state.runways) this.runways = state.runways;
        if (state.taxiways) this.taxiways = state.taxiways;
        if (state.groundVehicles) this.groundVehicles = state.groundVehicles;
        if (state.weather) this.weather = state.weather;
        if (state.players) this.players = state.players;
        
        this.score = state.score || 0;
        this.delayCount = state.delayCount || 0;
        this.planesHandled = state.planesHandled || 0;
        this.isRunning = state.isRunning || false;
        this.selectedPlane = state.selectedPlane;
        this.selectedVehicle = state.selectedVehicle;
        
        this.updateUI();
    }
    
    selectRole(role) {
        this.playerRole = role;
        this.roleApproachBtn.classList.toggle('active', role === 'approach');
        this.roleTowerBtn.classList.toggle('active', role === 'tower');
        
        this.sendMessage('join', { role });
        
        const roleName = role === 'approach' ? '进近管制' : '塔台管制';
        alert(`已选择角色: ${roleName}`);
    }
    
    startGame() {
        if (!this.playerRole) {
            alert('请先选择角色！');
            return;
        }
        
        this.isHost = true;
        this.sendMessage('startGame');
        
        this.isRunning = true;
        this.isPaused = false;
        this.gameTime = 0;
        
        this.startBtn.disabled = true;
        this.pauseBtn.disabled = false;
        
        this.gameLoop = setInterval(() => this.update(), 1000);
        this.spawnInterval = setInterval(() => this.spawnPlane(), 5000);
        this.weatherInterval = setInterval(() => this.checkWeatherChange(), 30000);
        
        for (let i = 0; i < 2; i++) {
            setTimeout(() => this.spawnPlane(), i * 1500);
        }
        
        this.updateUI();
    }
    
    togglePause() {
        this.isPaused = !this.isPaused;
        this.pauseBtn.textContent = this.isPaused ? '继续' : '暂停';
    }
    
    spawnPlane() {
        if (this.isPaused || !this.isHost) return;
        
        const isDeparture = Math.random() > 0.5;
        const plane = {
            id: ++this.planeIdCounter,
            flightNumber: `CA${Math.floor(Math.random() * 9000) + 1000}`,
            type: isDeparture ? 'departure' : 'arrival',
            waitTime: 0,
            status: 'waiting',
            needsDeice: this.weather.type === 'snow' || this.weather.type === 'rain',
            deiced: false
        };
        
        if (isDeparture) {
            this.departureQueue.push(plane);
        } else {
            this.arrivalQueue.push(plane);
        }
        
        this.syncState();
        this.updateUI();
    }
    
    checkWeatherChange() {
        if (this.isPaused || !this.isHost) return;
        
        if (this.weather.remaining > 0) {
            this.weather.remaining--;
            if (this.weather.remaining === 0) {
                this.weather.type = 'clear';
                this.weather.intensity = 0;
                Object.keys(this.runways).forEach(key => {
                    this.runways[key].closed = false;
                });
            }
            this.syncState();
            return;
        }
        
        if (Math.random() < 0.3) {
            const weatherTypes = ['rain', 'snow', 'storm'];
            const newWeather = weatherTypes[Math.floor(Math.random() * weatherTypes.length)];
            this.weather.type = newWeather;
            this.weather.intensity = Math.floor(Math.random() * 3) + 1;
            this.weather.remaining = 3 + Math.floor(Math.random() * 3);
            
            if (newWeather === 'storm') {
                const runwayKeys = Object.keys(this.runways);
                const closeCount = Math.floor(Math.random() * runwayKeys.length);
                for (let i = 0; i < closeCount; i++) {
                    const runway = runwayKeys[Math.floor(Math.random() * runwayKeys.length)];
                    this.runways[runway].closed = true;
                }
            }
            
            if (newWeather === 'snow' || newWeather === 'rain') {
                [...this.departureQueue, ...this.arrivalQueue].forEach(plane => {
                    plane.needsDeice = true;
                });
            }
        }
        
        this.syncState();
    }
    
    update() {
        if (this.isPaused) return;
        
        this.gameTime++;
        
        this.departureQueue.forEach(plane => {
            plane.waitTime++;
            if (plane.waitTime > 0 && plane.waitTime % 15 === 0) {
                this.delayCount++;
                this.score = Math.max(0, this.score - 10);
            }
        });
        
        this.arrivalQueue.forEach(plane => {
            plane.waitTime++;
            if (plane.waitTime > 0 && plane.waitTime % 15 === 0) {
                this.delayCount++;
                this.score = Math.max(0, this.score - 10);
            }
        });
        
        this.updateActivePlanes();
        this.updateGroundVehicles();
        
        if (this.planesHandled >= 30) {
            this.endGame();
        }
        
        this.syncState();
        this.updateUI();
    }
    
    updateActivePlanes() {
        this.activePlanes.forEach((plane, index) => {
            if (!plane.processingTime) plane.processingTime = 0;
            
            if (plane.needsDeice && !plane.deiced) {
                return;
            }
            
            plane.processingTime++;
            
            if (plane.processingTime >= 10) {
                this.completePlaneProcessing(plane, index);
            }
        });
    }
    
    updateGroundVehicles() {
        this.groundVehicles.forEach(vehicle => {
            if (vehicle.status === 'busy' && vehicle.location) {
                vehicle.processingTime++;
                
                if (vehicle.processingTime >= 5) {
                    const plane = this.activePlanes.find(p => p.id === vehicle.location);
                    if (plane) {
                        if (vehicle.type === 'deice') {
                            plane.deiced = true;
                            plane.needsDeice = false;
                        }
                    }
                    
                    vehicle.status = 'idle';
                    vehicle.location = null;
                    vehicle.processingTime = 0;
                }
            }
        });
    }
    
    completePlaneProcessing(plane, index) {
        if (plane.location === 'runway') {
            this.runways[plane.runwayId].occupied = false;
            this.runways[plane.runwayId].plane = null;
            
            if (plane.type === 'arrival') {
                const freeTaxiway = Object.keys(this.taxiways).find(key => !this.taxiways[key].occupied);
                if (freeTaxiway) {
                    plane.location = 'taxiway';
                    plane.taxiwayId = freeTaxiway;
                    plane.processingTime = 0;
                    this.taxiways[freeTaxiway].occupied = true;
                    this.taxiways[freeTaxiway].plane = plane;
                    this.movePlaneToTaxiway(plane, freeTaxiway);
                } else {
                    this.score += 50;
                    this.planesHandled++;
                    this.activePlanes.splice(index, 1);
                    this.removePlaneFromUI(plane);
                }
            } else {
                this.score += 100;
                this.planesHandled++;
                this.activePlanes.splice(index, 1);
                this.removePlaneFromUI(plane);
            }
        } else if (plane.location === 'taxiway') {
            this.taxiways[plane.taxiwayId].occupied = false;
            this.taxiways[plane.taxiwayId].plane = null;
            this.score += 50;
            this.planesHandled++;
            this.activePlanes.splice(index, 1);
            this.removePlaneFromUI(plane);
        }
    }
    
    assignToRunway(runwayId) {
        if (!this.selectedPlane) return;
        if (this.runways[runwayId].occupied || this.runways[runwayId].closed) {
            alert(this.runways[runwayId].closed ? '该跑道因天气关闭！' : '该跑道已被占用！');
            return;
        }
        
        if (this.playerRole === 'approach' && this.selectedPlane.type === 'arrival') {
            alert('进近管制只能管理起飞航班！');
            return;
        }
        if (this.playerRole === 'tower' && this.selectedPlane.type === 'departure') {
            alert('塔台管制只能管理降落航班！');
            return;
        }
        
        const plane = this.selectedPlane;
        
        if (plane.type === 'departure') {
            const index = this.departureQueue.findIndex(p => p.id === plane.id);
            if (index > -1) this.departureQueue.splice(index, 1);
        } else {
            const index = this.arrivalQueue.findIndex(p => p.id === plane.id);
            if (index > -1) this.arrivalQueue.splice(index, 1);
        }
        
        plane.location = 'runway';
        plane.runwayId = runwayId;
        plane.processingTime = 0;
        
        this.runways[runwayId].occupied = true;
        this.runways[runwayId].plane = plane;
        this.activePlanes.push(plane);
        
        this.displayPlaneOnRunway(plane, runwayId);
        
        this.selectedPlane = null;
        this.syncState();
        this.updateUI();
    }
    
    assignToTaxiway(taxiwayId) {
        if (!this.selectedPlane) return;
        if (this.taxiways[taxiwayId].occupied) {
            alert('该滑行道已被占用！');
            return;
        }
        
        if (this.selectedPlane.type === 'departure') {
            alert('起飞的飞机不能直接使用滑行道！');
            return;
        }
        
        if (this.playerRole === 'approach') {
            alert('进近管制只能管理起飞航班！');
            return;
        }
        
        const plane = this.selectedPlane;
        const index = this.arrivalQueue.findIndex(p => p.id === plane.id);
        if (index > -1) this.arrivalQueue.splice(index, 1);
        
        plane.location = 'taxiway';
        plane.taxiwayId = taxiwayId;
        plane.processingTime = 0;
        
        this.taxiways[taxiwayId].occupied = true;
        this.taxiways[taxiwayId].plane = plane;
        this.activePlanes.push(plane);
        
        this.displayPlaneOnTaxiway(plane, taxiwayId);
        
        this.selectedPlane = null;
        this.syncState();
        this.updateUI();
    }
    
    assignVehicleToPlane(vehicle, plane) {
        if (vehicle.status !== 'idle') {
            alert('该车辆正在工作中！');
            return;
        }
        
        if (!plane.needsDeice && vehicle.type === 'deice') {
            alert('该飞机不需要除冰！');
            return;
        }
        
        vehicle.status = 'busy';
        vehicle.location = plane.id;
        vehicle.processingTime = 0;
        
        this.displayVehicleOnPlane(vehicle, plane);
        this.selectedVehicle = null;
        this.syncState();
        this.updateUI();
    }
    
    displayPlaneOnRunway(plane, runwayId) {
        const runwayEl = document.getElementById(runwayId);
        const planeEl = document.createElement('div');
        planeEl.className = `plane ${plane.type} ${plane.needsDeice && !plane.deiced ? 'needs-deice' : ''}`;
        planeEl.id = `plane-${plane.id}`;
        planeEl.textContent = '✈️';
        planeEl.innerHTML += `<span class="plane-info">${plane.flightNumber}</span>`;
        planeEl.style.left = '10%';
        planeEl.style.top = runwayEl.offsetTop + 20 + 'px';
        this.airportEl.appendChild(planeEl);
        
        setTimeout(() => {
            planeEl.style.left = '80%';
        }, 100);
    }
    
    displayPlaneOnTaxiway(plane, taxiwayId) {
        const taxiwayEl = document.getElementById(taxiwayId);
        const planeEl = document.createElement('div');
        planeEl.className = `plane ${plane.type}`;
        planeEl.id = `plane-${plane.id}`;
        planeEl.textContent = '✈️';
        planeEl.innerHTML += `<span class="plane-info">${plane.flightNumber}</span>`;
        planeEl.style.left = '10%';
        planeEl.style.top = taxiwayEl.offsetTop + 10 + 'px';
        this.airportEl.appendChild(planeEl);
        
        setTimeout(() => {
            planeEl.style.left = '80%';
        }, 100);
    }
    
    movePlaneToTaxiway(plane, taxiwayId) {
        const planeEl = document.getElementById(`plane-${plane.id}`);
        const taxiwayEl = document.getElementById(taxiwayId);
        if (planeEl && taxiwayEl) {
            planeEl.style.top = taxiwayEl.offsetTop + 10 + 'px';
            planeEl.style.left = '10%';
            setTimeout(() => {
                planeEl.style.left = '80%';
            }, 100);
        }
    }
    
    displayVehicleOnPlane(vehicle, plane) {
        const vehicleEl = document.getElementById(`vehicle-${vehicle.id}`) || document.createElement('div');
        vehicleEl.className = `vehicle ${vehicle.status}`;
        vehicleEl.id = `vehicle-${vehicle.id}`;
        
        const icons = { deice: '🚑', tug: '🚜', fuel: '⛽' };
        vehicleEl.textContent = icons[vehicle.type] || '🚗';
        
        const planeEl = document.getElementById(`plane-${plane.id}`);
        if (planeEl) {
            const rect = planeEl.getBoundingClientRect();
            const airportRect = this.airportEl.getBoundingClientRect();
            vehicleEl.style.left = (rect.left - airportRect.left + rect.width) + 'px';
            vehicleEl.style.top = (rect.top - airportRect.top) + 'px';
        }
        
        if (!document.getElementById(`vehicle-${vehicle.id}`)) {
            this.airportEl.appendChild(vehicleEl);
        }
    }
    
    removePlaneFromUI(plane) {
        const planeEl = document.getElementById(`plane-${plane.id}`);
        if (planeEl) {
            planeEl.style.opacity = '0';
            setTimeout(() => planeEl.remove(), 500);
        }
    }
    
    syncState() {
        const state = {
            planes: {
                departure: this.departureQueue,
                arrival: this.arrivalQueue,
                active: this.activePlanes
            },
            runways: this.runways,
            taxiways: this.taxiways,
            groundVehicles: this.groundVehicles,
            weather: this.weather,
            score: this.score,
            delayCount: this.delayCount,
            planesHandled: this.planesHandled,
            isRunning: this.isRunning,
            selectedPlane: this.selectedPlane,
            selectedVehicle: this.selectedVehicle
        };
        this.sendMessage('state', state);
    }
    
    updateQueuesUI() {
        this.departureListEl.innerHTML = '';
        this.departureQueue.forEach(plane => {
            const item = document.createElement('div');
            item.className = `queue-item ${this.selectedPlane?.id === plane.id ? 'selected' : ''} ${plane.needsDeice && !plane.deiced ? 'needs-deice' : ''}`;
            item.innerHTML = `
                <span class="flight-icon">🛫</span>
                <div class="flight-info">
                    <div class="flight-number">${plane.flightNumber}</div>
                    <div class="flight-type">起飞 ${plane.needsDeice && !plane.deiced ? '❄️需除冰' : ''}</div>
                </div>
                <span class="wait-time">${plane.waitTime}s</span>
            `;
            item.addEventListener('click', () => {
                this.selectedPlane = plane;
                this.selectedVehicle = null;
                this.updateUI();
            });
            this.departureListEl.appendChild(item);
        });
        
        this.arrivalListEl.innerHTML = '';
        this.arrivalQueue.forEach(plane => {
            const item = document.createElement('div');
            item.className = `queue-item ${this.selectedPlane?.id === plane.id ? 'selected' : ''} ${plane.needsDeice && !plane.deiced ? 'needs-deice' : ''}`;
            item.innerHTML = `
                <span class="flight-icon">🛬</span>
                <div class="flight-info">
                    <div class="flight-number">${plane.flightNumber}</div>
                    <div class="flight-type">降落 ${plane.needsDeice && !plane.deiced ? '❄️需除冰' : ''}</div>
                </div>
                <span class="wait-time">${plane.waitTime}s</span>
            `;
            item.addEventListener('click', () => {
                this.selectedPlane = plane;
                this.selectedVehicle = null;
                this.updateUI();
            });
            this.arrivalListEl.appendChild(item);
        });
        
        this.vehicleListEl.innerHTML = '';
        this.groundVehicles.forEach(vehicle => {
            const item = document.createElement('div');
            item.className = `vehicle-item ${vehicle.status} ${this.selectedVehicle?.id === vehicle.id ? 'selected' : ''}`;
            
            const icons = { deice: '❄️', tug: '🚜', fuel: '⛽' };
            const statusText = { idle: '空闲', busy: '工作中' };
            
            item.innerHTML = `
                <span class="vehicle-icon">${icons[vehicle.type] || '🚗'}</span>
                <div class="vehicle-info">
                    <div class="vehicle-name">${vehicle.name}</div>
                    <div class="vehicle-status">${statusText[vehicle.status] || vehicle.status}</div>
                </div>
            `;
            
            if (vehicle.status === 'idle') {
                item.addEventListener('click', () => {
                    if (this.selectedPlane && this.selectedPlane.needsDeice) {
                        this.assignVehicleToPlane(vehicle, this.selectedPlane);
                    } else {
                        this.selectedVehicle = vehicle;
                        this.updateUI();
                    }
                });
            }
            
            this.vehicleListEl.appendChild(item);
        });
    }
    
    updateRunwaysUI() {
        Object.keys(this.runways).forEach(runwayId => {
            const runwayEl = document.getElementById(runwayId);
            const statusEl = document.getElementById(`${runwayId}Status`);
            
            if (this.runways[runwayId].closed) {
                runwayEl.classList.add('closed');
                if (statusEl) statusEl.textContent = '⛔';
            } else {
                runwayEl.classList.remove('closed');
                if (statusEl) {
                    statusEl.textContent = this.runways[runwayId].occupied ? '✈️' : '';
                }
            }
        });
    }
    
    updateWeatherUI() {
        const weatherIcons = {
            clear: '☀️',
            rain: '🌧️',
            snow: '❄️',
            storm: '⛈️'
        };
        const weatherTexts = {
            clear: '晴朗',
            rain: '下雨',
            snow: '下雪',
            storm: '暴风雨'
        };
        
        this.weatherIconEl.textContent = weatherIcons[this.weather.type] || '☀️';
        this.weatherTextEl.textContent = weatherTexts[this.weather.type] || '晴朗';
        
        this.weatherDisplayEl.className = 'weather-display ' + this.weather.type;
        
        let weatherEffectEl = document.querySelector('.weather-effect');
        if (this.weather.type !== 'clear') {
            if (!weatherEffectEl) {
                weatherEffectEl = document.createElement('div');
                weatherEffectEl.className = 'weather-effect';
                this.airportEl.appendChild(weatherEffectEl);
            }
            
            weatherEffectEl.innerHTML = '';
            const particleCount = this.weather.type === 'storm' ? 50 : (this.weather.type === 'rain' ? 30 : 20);
            
            for (let i = 0; i < particleCount; i++) {
                const particle = document.createElement('div');
                particle.className = this.weather.type === 'snow' ? 'snow-flake' : 'rain-drop';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.animationDelay = Math.random() * 2 + 's';
                particle.style.animationDuration = (this.weather.type === 'snow' ? 3 : 0.5) + 's';
                weatherEffectEl.appendChild(particle);
            }
        } else if (weatherEffectEl) {
            weatherEffectEl.remove();
        }
    }
    
    updateUI() {
        this.scoreEl.textContent = this.score;
        this.delayEl.textContent = this.delayCount;
        this.handledEl.textContent = this.planesHandled;
        this.updateQueuesUI();
        this.updateRunwaysUI();
        this.updateWeatherUI();
    }
    
    endGame() {
        this.isRunning = false;
        clearInterval(this.gameLoop);
        clearInterval(this.spawnInterval);
        clearInterval(this.weatherInterval);
        
        this.finalScoreEl.textContent = this.score;
        this.finalHandledEl.textContent = this.planesHandled;
        this.finalDelayEl.textContent = this.delayCount;
        
        this.gameOverModal.style.display = 'block';
        
        this.startBtn.disabled = false;
        this.pauseBtn.disabled = true;
    }
    
    restartGame() {
        this.gameOverModal.style.display = 'none';
        this.startGame();
    }
    
    async saveRecord() {
        try {
            const response = await fetch('/api/records', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    score: this.score,
                    delayCount: this.delayCount,
                    planesHandled: this.planesHandled
                })
            });
            
            if (response.ok) {
                alert('记录保存成功！');
                this.saveRecordBtn.disabled = true;
            }
        } catch (error) {
            console.error('保存记录失败:', error);
            alert('保存记录失败');
        }
    }
    
    async showRecords() {
        try {
            const response = await fetch('/api/records');
            const records = await response.json();
            
            this.recordsListEl.innerHTML = '';
            
            if (records.length === 0) {
                this.recordsListEl.innerHTML = '<p style="text-align:center;color:#666;">暂无记录</p>';
            } else {
                records.slice(0, 10).forEach((record, index) => {
                    const item = document.createElement('div');
                    item.className = 'record-item';
                    const date = record.date ? new Date(record.date) : null;
                    item.innerHTML = `
                        <span class="rank">#${index + 1}</span>
                        <div class="details">
                            <div class="score">${record.score} 分</div>
                            <div class="meta">处理 ${record.planesHandled} 架 | 延误 ${record.delayCount} 次</div>
                            ${date ? `<div class="meta">${date.toLocaleString()}</div>` : ''}
                        </div>
                    `;
                    this.recordsListEl.appendChild(item);
                });
            }
            
            this.recordsModal.style.display = 'block';
        } catch (error) {
            console.error('获取记录失败:', error);
            alert('获取记录失败');
        }
    }
}

const game = new AirportSimulator();
