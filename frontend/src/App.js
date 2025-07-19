import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>🏖️ Malecom Suits</h1>
        <p>Vacation Rental Platform</p>
        <div className="status-grid">
          <div className="status-card">
            <h3>🚀 Backend API</h3>
            <p>Running on port 5000</p>
            <a href="http://localhost:5000/health" target="_blank" rel="noopener noreferrer">
              Health Check
            </a>
          </div>
          <div className="status-card">
            <h3>🗄️ Database</h3>
            <p>MySQL with sample data</p>
            <a href="http://localhost:8080" target="_blank" rel="noopener noreferrer">
              Database Admin
            </a>
          </div>
          <div className="status-card">
            <h3>📋 API Documentation</h3>
            <p>Interactive API docs</p>
            <a href="http://localhost:5000/api/v1" target="_blank" rel="noopener noreferrer">
              View API Docs
            </a>
          </div>
        </div>
        <div className="quick-test">
          <h3>🧪 Quick API Test</h3>
          <button onClick={testAPI}>Test API Connection</button>
          <pre id="api-result"></pre>
        </div>
      </header>
    </div>
  );
}

function testAPI() {
  const resultElement = document.getElementById('api-result');
  resultElement.textContent = 'Testing...';
  
  fetch('/api/v1/suites')
    .then(response => response.json())
    .then(data => {
      resultElement.textContent = JSON.stringify(data, null, 2);
    })
    .catch(error => {
      resultElement.textContent = 'Error: ' + error.message;
    });
}

export default App;
