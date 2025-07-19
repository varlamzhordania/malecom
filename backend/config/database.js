// backend/config/database.js
const mysql = require('mysql2/promise');

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'malecom_suits',
  charset: 'utf8mb4',
  
  // Connection pool settings
  acquireTimeout: 60000,
  timeout: 60000,
  connectionLimit: 10,
  queueLimit: 0,
  reconnect: true,
  
  // SSL configuration for production
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,

  // Timezone handling
  timezone: '+00:00',
  dateStrings: false,
  
  // Additional MySQL settings
  supportBigNumbers: true,
  bigNumberStrings: true,
  multipleStatements: false,
  flags: [
    'COMPRESS',
    'PROTOCOL_41',
    'TRANSACTIONS',
    'RESERVED',
    'SECURE_CONNECTION',
    'MULTI_RESULTS'
  ]
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Connection health check
const checkConnection = async () => {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('✅ Database connection established successfully');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Initialize database connection
const initializeDatabase = async () => {
  try {
    // Check connection
    const isConnected = await checkConnection();
    if (!isConnected) {
      throw new Error('Failed to establish database connection');
    }

    // Set session variables for better performance
    await pool.execute("SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    await pool.execute("SET SESSION time_zone='+00:00'");
    
    console.log('✅ Database initialized successfully');
    return pool;

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const closeDatabase = async () => {
  try {
    await pool.end();
    console.log('✅ Database connections closed successfully');
  } catch (error) {
    console.error('❌ Error closing database connections:', error);
  }
};

// Database transaction helper
const transaction = async (callback) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Query helper with error handling and logging
const query = async (sql, params = []) => {
  const startTime = Date.now();
  
  try {
    const [results] = await pool.execute(sql, params);
    const duration = Date.now() - startTime;
    
    // Log slow queries (>1000ms)
    if (duration > 1000) {
      console.warn(`⚠️ Slow query detected (${duration}ms):`, sql.substring(0, 100) + '...');
    }
    
    return results;
  } catch (error) {
    console.error('❌ Database query error:', {
      sql: sql.substring(0, 200) + '...',
      params: params.length > 0 ? params : 'none',
      error: error.message
    });
    throw error;
  }
};

// Bulk insert helper
const bulkInsert = async (table, columns, data, options = {}) => {
  if (!data || data.length === 0) {
    return { affectedRows: 0, insertId: 0 };
  }

  const {
    onDuplicateUpdate = false,
    batchSize = 1000,
    ignore = false
  } = options;

  const placeholders = columns.map(() => '?').join(',');
  const valueClause = `(${placeholders})`;
  
  let sql = `INSERT ${ignore ? 'IGNORE' : ''} INTO ${table} (${columns.join(',')}) VALUES `;
  
  if (onDuplicateUpdate) {
    const updateClause = columns
      .filter(col => col !== 'id' && col !== 'created_at')
      .map(col => `${col} = VALUES(${col})`)
      .join(',');
    sql += ' ON DUPLICATE KEY UPDATE ' + updateClause;
  }

  let totalAffectedRows = 0;
  let lastInsertId = 0;

  // Process in batches
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    const batchValues = batch.map(() => valueClause).join(',');
    const batchSql = sql.replace('VALUES ', `VALUES ${batchValues}`);
    
    const flattenedParams = batch.flat();
    
    try {
      const [result] = await pool.execute(batchSql, flattenedParams);
      totalAffectedRows += result.affectedRows;
      if (result.insertId) {
        lastInsertId = result.insertId;
      }
    } catch (error) {
      console.error('❌ Bulk insert error:', error);
      throw error;
    }
  }

  return {
    affectedRows: totalAffectedRows,
    insertId: lastInsertId
  };
};

// Database migration helper
const migrate = async (migrationSql) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Split and execute multiple statements
    const statements = migrationSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    for (const statement of statements) {
      await connection.execute(statement);
    }
    
    await connection.commit();
    console.log('✅ Migration completed successfully');
    
  } catch (error) {
    await connection.rollback();
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    connection.release();
  }
};

// Database backup helper
const createBackup = async (outputPath) => {
  try {
    const { spawn } = require('child_process');
    
    const mysqldump = spawn('mysqldump', [
      '--host=' + dbConfig.host,
      '--user=' + dbConfig.user,
      '--password=' + dbConfig.password,
      '--single-transaction',
      '--routines',
      '--triggers',
      dbConfig.database
    ]);

    const fs = require('fs');
    const writeStream = fs.createWriteStream(outputPath);
    
    mysqldump.stdout.pipe(writeStream);
    
    return new Promise((resolve, reject) => {
      mysqldump.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Database backup created:', outputPath);
          resolve(outputPath);
        } else {
          reject(new Error(`Backup failed with code ${code}`));
        }
      });
      
      mysqldump.stderr.on('data', (data) => {
        console.error('Backup error:', data.toString());
      });
    });
    
  } catch (error) {
    console.error('❌ Backup creation failed:', error);
    throw error;
  }
};

// Get database statistics
const getStats = async () => {
  try {
    const [tables] = await pool.execute(`
      SELECT 
        table_name,
        table_rows,
        data_length,
        index_length,
        (data_length + index_length) as total_size
      FROM information_schema.tables 
      WHERE table_schema = ?
    `, [dbConfig.database]);

    const [connections] = await pool.execute('SHOW STATUS LIKE "Threads_connected"');
    const [maxConnections] = await pool.execute('SHOW VARIABLES LIKE "max_connections"');

    return {
      tables: tables.map(table => ({
        name: table.table_name,
        rows: table.table_rows,
        dataSize: table.data_length,
        indexSize: table.index_length,
        totalSize: table.total_size
      })),
      connections: {
        current: connections[0]?.Value || 0,
        max: maxConnections[0]?.Value || 0
      },
      poolInfo: {
        total: pool.pool._allConnections?.length || 0,
        free: pool.pool._freeConnections?.length || 0,
        used: (pool.pool._allConnections?.length || 0) - (pool.pool._freeConnections?.length || 0)
      }
    };
  } catch (error) {
    console.error('❌ Error getting database stats:', error);
    throw error;
  }
};

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n📋 Received SIGINT, closing database connections...');
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n📋 Received SIGTERM, closing database connections...');
  await closeDatabase();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('❌ Uncaught Exception:', error);
  await closeDatabase();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  await closeDatabase();
  process.exit(1);
});

module.exports = {
  pool,
  initializeDatabase,
  closeDatabase,
  checkConnection,
  transaction,
  query,
  bulkInsert,
  migrate,
  createBackup,
  getStats
};