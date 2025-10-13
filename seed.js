const bcrypt = require('bcrypt');
const pool = require('./db'); // Assumes your db.js file is in the same directory

// The original users you had, with plain-text passwords.
// I've added placeholder first and last names as required by the new table structure.
const originalUsers = [
    { email: "admin@company.com", password: "admin123", department: "Admin", firstName: "Admin", lastName: "User" },
    { email: "amit@globalxperts.org", password: "AKS123", department: "Admin", firstName: "Admin", lastName: "User" },
    { email: "hr@company.com", password: "hr123", department: "HR", firstName: "HR", lastName: "User" },
    { email: "pmo@company.com", password: "pmo123", department: "PMO", firstName: "PMO", lastName: "User" },
    { email: "gta@company.com", password: "gta123", department: "GTA", firstName: "GTA", lastName: "User" },
];

async function seedUsers() {
    console.log('Starting to seed initial users into the database...');
    const client = await pool.connect();
    try {
        for (const user of originalUsers) {
            const saltRounds = 10;
            // Securely hash the password
            const passwordHash = await bcrypt.hash(user.password, saltRounds);

            // Insert the user into the database table
            await client.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, department)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (email) DO NOTHING;`, // This prevents errors if you accidentally run the script more than once
                [user.firstName, user.lastName, user.email, passwordHash, user.department]
            );
            console.log(`- User ${user.email} processed.`);
        }
        console.log('✅ User seeding completed successfully!');
    } catch (error) {
        console.error('❌ Error seeding users:', error);
    } finally {
        // Release the client and close the connection pool
        await client.release();
        await pool.end();
    }
}

seedUsers();