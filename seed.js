const bcrypt = require('bcrypt');
const pool = require('./db.js'); // Assumes your db.js file is in the same directory
require('dotenv').config(); // Make sure dotenv is loaded to access process.env

// The original users you had, with plain-text passwords.
// Department should now be an array, even if it's just one item.
const originalUsers = [
    { email: "vanshu2004sabharwal@gmail.com", password: "admin123", departments: ["Admin"], firstName: "Vansh", lastName: "Sabharwal" },
    { email: "amit@globalxperts.org", password: "AKS123", departments: ["Admin"], firstName: "Amit K", lastName: "Sharma" },
    // Add more users here if needed, following the same format
];

async function seedUsers() {
    console.log('Starting to seed initial users into the database...');
    const client = await pool.connect();
    try {
        for (const user of originalUsers) {
            const saltRounds = 10;
            // Securely hash the password
            const passwordHash = await bcrypt.hash(user.password, saltRounds);

            // --- FIX IS HERE ---
            // Ensure departments is an array in JS first
            const departmentsArray = Array.isArray(user.departments) ? user.departments : [user.departments];
            // Format for PostgreSQL: '{Admin}' or '{HR,GTA}'
            const departmentLiteral = `{${departmentsArray.join(',')}}`;
            // --- END FIX ---

            // Insert the user into the database table, including is_active
            await client.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, department, is_active)
                 VALUES ($1, $2, $3, $4, $5, true)
                 ON CONFLICT (email) DO NOTHING;`, // Prevents errors if user exists
                [user.firstName, user.lastName, user.email, passwordHash, departmentLiteral] // Pass the formatted literal
            );
            console.log(`- User ${user.email} processed.`);
        }
        console.log('✅ User seeding completed successfully!');
    } catch (error) {
        console.error('❌ Error seeding users:', error);
    } finally {
        // Release the client and close the connection pool
        if (client) {
            await client.release();
        }
        // It's often better to not end the pool in a script if other parts of your app might use it.
        // Consider removing pool.end() if this script runs alongside your main server.
        // await pool.end();
        console.log('Database connection closed or released.');
    }
}

// Call the function to run the seeding process
seedUsers();