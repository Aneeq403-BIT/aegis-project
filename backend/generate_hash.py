import bcrypt

password = "admin123"
# Generate a fresh salt and hash using YOUR installed library
hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())

print(f"Password: {password}")
print(f"New Hash: {hashed.decode('utf-8')}")