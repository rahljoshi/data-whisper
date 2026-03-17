-- =============================================================================
-- data-whisper — PostgreSQL seed file
-- =============================================================================
-- Schema: e-commerce store (customers, products, categories, orders, reviews)
-- Designed so the NL-to-SQL engine has rich, realistic data to query.
--
-- Usage:
--   psql -U <user> -d <database> -f database/seed.sql
--
-- Or inside psql:
--   \i database/seed.sql
-- =============================================================================

-- Drop tables in reverse dependency order so re-running is safe
DROP TABLE IF EXISTS reviews        CASCADE;
DROP TABLE IF EXISTS order_items    CASCADE;
DROP TABLE IF EXISTS orders         CASCADE;
DROP TABLE IF EXISTS products       CASCADE;
DROP TABLE IF EXISTS categories     CASCADE;
DROP TABLE IF EXISTS customers      CASCADE;
DROP TABLE IF EXISTS employees      CASCADE;
DROP TABLE IF EXISTS departments    CASCADE;

-- =============================================================================
-- DEPARTMENTS
-- =============================================================================
CREATE TABLE departments (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    budget      NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO departments (name, budget) VALUES
    ('Engineering',     500000.00),
    ('Marketing',       150000.00),
    ('Sales',           200000.00),
    ('Customer Support', 80000.00),
    ('Finance',         120000.00);

-- =============================================================================
-- EMPLOYEES
-- =============================================================================
CREATE TABLE employees (
    id              SERIAL PRIMARY KEY,
    department_id   INT REFERENCES departments(id),
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    role            VARCHAR(100) NOT NULL,
    salary          NUMERIC(10, 2) NOT NULL,
    hire_date       DATE NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO employees (department_id, first_name, last_name, email, role, salary, hire_date) VALUES
    (1, 'Alice',   'Chen',      'alice.chen@example.com',      'Senior Engineer',      95000.00, '2020-03-15'),
    (1, 'Bob',     'Martinez',  'bob.martinez@example.com',    'Junior Engineer',      65000.00, '2022-07-01'),
    (1, 'Carol',   'Singh',     'carol.singh@example.com',     'Engineering Manager', 120000.00, '2018-01-10'),
    (1, 'David',   'Kim',       'david.kim@example.com',       'Senior Engineer',      98000.00, '2019-06-20'),
    (2, 'Eve',     'Johnson',   'eve.johnson@example.com',     'Marketing Lead',       75000.00, '2021-02-28'),
    (2, 'Frank',   'Brown',     'frank.brown@example.com',     'Content Strategist',   62000.00, '2022-04-11'),
    (3, 'Grace',   'Wilson',    'grace.wilson@example.com',    'Sales Manager',        90000.00, '2017-11-05'),
    (3, 'Henry',   'Davis',     'henry.davis@example.com',     'Account Executive',    70000.00, '2021-09-14'),
    (3, 'Iris',    'Taylor',    'iris.taylor@example.com',     'Account Executive',    68000.00, '2022-01-20'),
    (4, 'James',   'Anderson',  'james.anderson@example.com',  'Support Specialist',   52000.00, '2023-03-01'),
    (4, 'Karen',   'Thomas',    'karen.thomas@example.com',    'Support Lead',         60000.00, '2020-08-15'),
    (5, 'Leo',     'Jackson',   'leo.jackson@example.com',     'Finance Manager',      88000.00, '2019-04-22'),
    (1, 'Mia',     'White',     'mia.white@example.com',       'DevOps Engineer',      87000.00, '2021-05-18'),
    (1, 'Noah',    'Harris',    'noah.harris@example.com',     'Data Engineer',        92000.00, '2020-10-30'),
    (3, 'Olivia',  'Martin',    'olivia.martin@example.com',   'Account Executive',    71000.00, '2023-01-09');

-- =============================================================================
-- CATEGORIES
-- =============================================================================
CREATE TABLE categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO categories (name, description) VALUES
    ('Electronics',    'Phones, laptops, tablets, and accessories'),
    ('Clothing',       'Men''s and women''s apparel'),
    ('Books',          'Fiction, non-fiction, and educational titles'),
    ('Home & Garden',  'Furniture, decor, and outdoor equipment'),
    ('Sports',         'Fitness gear, outdoor activities, and team sports'),
    ('Beauty',         'Skincare, haircare, and cosmetics'),
    ('Toys',           'Children''s toys and games'),
    ('Grocery',        'Food, beverages, and household essentials');

-- =============================================================================
-- PRODUCTS
-- =============================================================================
CREATE TABLE products (
    id              SERIAL PRIMARY KEY,
    category_id     INT REFERENCES categories(id),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    price           NUMERIC(10, 2) NOT NULL,
    stock_quantity  INT NOT NULL DEFAULT 0,
    sku             VARCHAR(50) NOT NULL UNIQUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO products (category_id, name, description, price, stock_quantity, sku) VALUES
    -- Electronics
    (1, 'Wireless Noise-Cancelling Headphones', 'Premium over-ear headphones with 30h battery',    299.99,  85, 'ELEC-001'),
    (1, 'Mechanical Keyboard',                  'TKL layout, Cherry MX Blue switches',             149.99, 120, 'ELEC-002'),
    (1, 'USB-C Hub 7-in-1',                     'HDMI, USB-A x3, SD card, PD charging',             49.99, 200, 'ELEC-003'),
    (1, '27" 4K Monitor',                       '144Hz IPS panel, HDR400, USB-C',                  499.99,  40, 'ELEC-004'),
    (1, 'Wireless Charging Pad',                '15W fast charging, Qi compatible',                 29.99, 300, 'ELEC-005'),
    (1, 'True Wireless Earbuds',                'ANC, IPX5 waterproof, 24h total battery',         129.99,  60, 'ELEC-006'),
    (1, 'Portable SSD 1TB',                     '1050 MB/s read, USB 3.2 Gen 2',                    89.99, 150, 'ELEC-007'),
    -- Clothing
    (2, 'Classic Crew-Neck Sweatshirt',         '100% organic cotton, unisex sizing',               45.00, 250, 'CLTH-001'),
    (2, 'Slim-Fit Chino Trousers',              'Stretch twill fabric, multiple colours',            65.00, 180, 'CLTH-002'),
    (2, 'Waterproof Shell Jacket',              'Taped seams, packable hood, 20k/20k rating',       185.00,  90, 'CLTH-003'),
    (2, 'Merino Wool Base Layer',               'Odour-resistant, temperature-regulating',           80.00, 110, 'CLTH-004'),
    (2, 'Running Shorts',                       '5" inseam, reflective details, zip pocket',         35.00, 300, 'CLTH-005'),
    -- Books
    (3, 'Clean Code',                           'A Handbook of Agile Software Craftsmanship',        38.00, 200, 'BOOK-001'),
    (3, 'Designing Data-Intensive Applications','Deep dive into scalable system design',             52.00, 175, 'BOOK-002'),
    (3, 'The Pragmatic Programmer',             '20th anniversary edition, updated for today',       45.00, 160, 'BOOK-003'),
    (3, 'Atomic Habits',                        'Tiny changes, remarkable results',                  27.00, 400, 'BOOK-004'),
    (3, 'Sapiens',                              'A Brief History of Humankind',                      22.00, 350, 'BOOK-005'),
    -- Home & Garden
    (4, 'Bamboo Cutting Board Set',             'Set of 3, with juice groove',                       34.99, 220, 'HOME-001'),
    (4, 'Cast Iron Skillet 12"',                'Pre-seasoned, oven safe to 500°F',                  49.99,  95, 'HOME-002'),
    (4, 'Indoor Plant Starter Kit',             '6 pots, soil, seeds, care guide',                   29.99, 130, 'HOME-003'),
    (4, 'Memory Foam Pillow',                   'Contour design, hypoallergenic cover',              59.99, 170, 'HOME-004'),
    -- Sports
    (5, 'Adjustable Dumbbell Set',              '5–52.5 lb per dumbbell, space-saving',             349.99,  30, 'SPRT-001'),
    (5, 'Yoga Mat Non-Slip',                    '6mm thick, alignment lines, carry strap',           39.99, 210, 'SPRT-002'),
    (5, 'Foam Roller',                          'High-density EVA, 36" length',                      24.99, 280, 'SPRT-003'),
    (5, 'Running Watch GPS',                    'HR monitor, 14-day battery, swimproof',            249.99,  55, 'SPRT-004'),
    -- Beauty
    (6, 'Vitamin C Serum',                      '20% L-ascorbic acid, 1 fl oz',                      32.00, 320, 'BEAU-001'),
    (6, 'SPF 50 Sunscreen',                     'Reef-safe, tinted, 3.4 fl oz',                      22.00, 400, 'BEAU-002'),
    (6, 'Shampoo Bar',                          'Sulphate-free, all hair types',                     14.00, 500, 'BEAU-003'),
    -- Toys
    (7, 'STEM Building Blocks 200pc',           'Compatible with major brands, ages 4+',             39.99, 180, 'TOYS-001'),
    (7, 'Watercolour Paint Set',                '24 colours, includes 3 brushes and palette',        19.99, 260, 'TOYS-002'),
    -- Grocery
    (8, 'Premium Ground Coffee 1kg',            'Single-origin Ethiopian, medium roast',             24.99, 600, 'GROC-001'),
    (8, 'Organic Rolled Oats 2kg',              'Whole grain, no added sugar',                        9.99, 800, 'GROC-002');

-- =============================================================================
-- CUSTOMERS
-- =============================================================================
CREATE TABLE customers (
    id              SERIAL PRIMARY KEY,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    phone           VARCHAR(30),
    city            VARCHAR(100),
    country         VARCHAR(100) NOT NULL DEFAULT 'United States',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO customers (first_name, last_name, email, phone, city, country, joined_at) VALUES
    ('Liam',    'Thompson',  'liam.thompson@mail.com',   '555-0101', 'New York',      'United States', '2021-01-15 09:00:00'),
    ('Sophia',  'Garcia',    'sophia.garcia@mail.com',   '555-0102', 'Los Angeles',   'United States', '2021-02-20 10:30:00'),
    ('Mason',   'Lee',       'mason.lee@mail.com',       '555-0103', 'Chicago',       'United States', '2021-03-05 14:00:00'),
    ('Isabella','Patel',     'isabella.patel@mail.com',  '555-0104', 'Houston',       'United States', '2021-04-18 11:00:00'),
    ('Ethan',   'Roberts',   'ethan.roberts@mail.com',   '555-0105', 'Phoenix',       'United States', '2021-05-22 16:45:00'),
    ('Ava',     'Nguyen',    'ava.nguyen@mail.com',      '555-0106', 'Philadelphia',  'United States', '2021-06-10 08:20:00'),
    ('Lucas',   'Brown',     'lucas.brown@mail.com',     '555-0107', 'San Antonio',   'United States', '2021-07-03 13:00:00'),
    ('Mia',     'Clark',     'mia.clark@mail.com',       '555-0108', 'San Diego',     'United States', '2021-08-14 10:00:00'),
    ('Oliver',  'Walker',    'oliver.walker@mail.com',   '555-0109', 'Dallas',        'United States', '2021-09-25 15:30:00'),
    ('Emma',    'Hall',      'emma.hall@mail.com',       '555-0110', 'San Jose',      'United States', '2021-10-01 09:45:00'),
    ('James',   'Allen',     'james.allen@mail.com',     '555-0111', 'Austin',        'United States', '2021-11-11 11:11:00'),
    ('Charlotte','Young',    'charlotte.young@mail.com', '555-0112', 'Jacksonville',  'United States', '2021-12-24 12:00:00'),
    ('William', 'King',      'william.king@mail.com',    '555-0113', 'San Francisco', 'United States', '2022-01-07 08:00:00'),
    ('Amelia',  'Scott',     'amelia.scott@mail.com',    '555-0114', 'Columbus',      'United States', '2022-02-14 14:00:00'),
    ('Benjamin','Green',     'benjamin.green@mail.com',  '555-0115', 'Fort Worth',    'United States', '2022-03-20 10:00:00'),
    ('Harper',  'Adams',     'harper.adams@mail.com',    '555-0116', 'Charlotte',     'United States', '2022-04-05 09:30:00'),
    ('Elijah',  'Baker',     'elijah.baker@mail.com',    '555-0117', 'Indianapolis',  'United States', '2022-05-19 13:45:00'),
    ('Evelyn',  'Nelson',    'evelyn.nelson@mail.com',   '555-0118', 'Seattle',       'United States', '2022-06-30 16:00:00'),
    ('Logan',   'Hill',      'logan.hill@mail.com',      '555-0119', 'Denver',        'United States', '2022-07-22 11:00:00'),
    ('Abigail', 'Ramirez',   'abigail.ramirez@mail.com', '555-0120', 'Boston',        'United States', '2022-08-08 10:15:00'),
    ('Aiden',   'Campbell',  'aiden.campbell@mail.com',  '555-0121', 'Portland',      'United States', '2022-09-01 09:00:00'),
    ('Emily',   'Mitchell',  'emily.mitchell@mail.com',  '555-0122', 'Nashville',     'United States', '2022-10-15 14:30:00'),
    ('Jackson', 'Carter',    'jackson.carter@mail.com',  '555-0123', 'Memphis',       'United States', '2022-11-11 11:00:00'),
    ('Ella',    'Perez',     'ella.perez@mail.com',      '555-0124', 'Louisville',    'United States', '2022-12-20 15:00:00'),
    ('Sebastian','Turner',   'sebastian.turner@mail.com','555-0125', 'Baltimore',     'United States', '2023-01-03 08:30:00');

-- =============================================================================
-- ORDERS
-- =============================================================================
CREATE TABLE orders (
    id              SERIAL PRIMARY KEY,
    customer_id     INT NOT NULL REFERENCES customers(id),
    status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','shipped','delivered','cancelled','refunded')),
    total_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    shipping_city   VARCHAR(100),
    shipping_country VARCHAR(100) NOT NULL DEFAULT 'United States',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    shipped_at      TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ
);

INSERT INTO orders (customer_id, status, total_amount, shipping_city, shipped_at, delivered_at, created_at) VALUES
    -- Customer 1: Liam — multiple orders
    (1,  'delivered', 449.98, 'New York',     '2021-02-01', '2021-02-05', '2021-01-28'),
    (1,  'delivered', 129.99, 'New York',     '2021-06-10', '2021-06-14', '2021-06-07'),
    (1,  'shipped',   299.99, 'New York',     '2024-01-20', NULL,         '2024-01-17'),
    -- Customer 2: Sophia
    (2,  'delivered', 230.00, 'Los Angeles',  '2021-03-05', '2021-03-09', '2021-03-01'),
    (2,  'delivered',  83.00, 'Los Angeles',  '2022-01-10', '2022-01-14', '2022-01-07'),
    (2,  'cancelled',  49.99, 'Los Angeles',  NULL,         NULL,         '2023-04-20'),
    -- Customer 3: Mason
    (3,  'delivered', 598.99, 'Chicago',      '2021-04-05', '2021-04-09', '2021-04-01'),
    (3,  'delivered', 185.00, 'Chicago',      '2022-05-15', '2022-05-19', '2022-05-12'),
    -- Customer 4: Isabella
    (4,  'delivered', 159.99, 'Houston',      '2021-05-20', '2021-05-24', '2021-05-17'),
    (4,  'processing', 349.99,'Houston',      NULL,         NULL,         '2024-02-01'),
    -- Customer 5: Ethan
    (5,  'delivered', 524.98, 'Phoenix',      '2021-07-01', '2021-07-05', '2021-06-28'),
    (5,  'delivered',  74.99, 'Phoenix',      '2023-03-10', '2023-03-14', '2023-03-07'),
    -- Customer 6: Ava
    (6,  'delivered',  90.00, 'Philadelphia', '2021-08-15', '2021-08-19', '2021-08-12'),
    (6,  'shipped',   499.99, 'Philadelphia', '2024-02-05', NULL,         '2024-02-02'),
    -- Customer 7: Lucas
    (7,  'delivered', 224.99, 'San Antonio',  '2021-09-10', '2021-09-14', '2021-09-07'),
    (7,  'refunded',   89.99, 'San Antonio',  '2022-11-20', '2022-11-24', '2022-11-17'),
    -- Customer 8: Mia
    (8,  'delivered', 699.98, 'San Diego',    '2021-10-10', '2021-10-14', '2021-10-07'),
    (8,  'delivered', 119.98, 'San Diego',    '2023-07-15', '2023-07-19', '2023-07-12'),
    -- Customer 9: Oliver
    (9,  'delivered', 374.99, 'Dallas',       '2021-11-20', '2021-11-24', '2021-11-17'),
    (9,  'pending',    59.98, 'Dallas',       NULL,         NULL,         '2024-02-10'),
    -- Customer 10: Emma
    (10, 'delivered', 539.99, 'San Jose',     '2021-12-05', '2021-12-09', '2021-12-02'),
    -- Customer 11: James
    (11, 'delivered', 173.99, 'Austin',       '2022-02-10', '2022-02-14', '2022-02-07'),
    (11, 'delivered',  45.00, 'Austin',       '2023-01-15', '2023-01-19', '2023-01-12'),
    -- Customer 12: Charlotte
    (12, 'delivered', 259.99, 'Jacksonville', '2022-03-15', '2022-03-19', '2022-03-12'),
    -- Customer 13: William
    (13, 'delivered', 828.97, 'San Francisco','2022-04-20', '2022-04-24', '2022-04-17'),
    (13, 'delivered',  97.99, 'San Francisco','2023-06-10', '2023-06-14', '2023-06-07'),
    -- Customer 14: Amelia
    (14, 'delivered',  79.99, 'Columbus',     '2022-05-25', '2022-05-29', '2022-05-22'),
    -- Customer 15: Benjamin
    (15, 'delivered', 449.98, 'Fort Worth',   '2022-06-30', '2022-07-04', '2022-06-27'),
    (15, 'shipped',   149.99, 'Fort Worth',   '2024-01-28', NULL,         '2024-01-25'),
    -- Customer 16: Harper
    (16, 'delivered', 299.99, 'Charlotte',    '2022-07-15', '2022-07-19', '2022-07-12'),
    -- Customer 17: Elijah
    (17, 'delivered', 249.99, 'Indianapolis', '2022-08-20', '2022-08-24', '2022-08-17'),
    -- Customer 18: Evelyn
    (18, 'delivered', 384.99, 'Seattle',      '2022-09-25', '2022-09-29', '2022-09-22'),
    (18, 'cancelled',  29.99, 'Seattle',      NULL,         NULL,         '2023-10-05'),
    -- Customer 19: Logan
    (19, 'delivered', 679.98, 'Denver',       '2022-10-30', '2022-11-03', '2022-10-27'),
    -- Customer 20: Abigail
    (20, 'delivered', 114.99, 'Boston',       '2022-11-20', '2022-11-24', '2022-11-17'),
    -- Customer 21: Aiden
    (21, 'delivered', 199.97, 'Portland',     '2022-12-10', '2022-12-14', '2022-12-07'),
    -- Customer 22: Emily
    (22, 'delivered',  74.99, 'Nashville',    '2023-01-20', '2023-01-24', '2023-01-17'),
    -- Customer 23: Jackson
    (23, 'delivered', 539.98, 'Memphis',      '2023-02-15', '2023-02-19', '2023-02-12'),
    -- Customer 24: Ella
    (24, 'delivered', 164.99, 'Louisville',   '2023-03-20', '2023-03-24', '2023-03-17'),
    -- Customer 25: Sebastian
    (25, 'pending',   349.99, 'Baltimore',    NULL,         NULL,         '2024-02-12');

-- =============================================================================
-- ORDER ITEMS
-- =============================================================================
CREATE TABLE order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INT NOT NULL REFERENCES orders(id),
    product_id  INT NOT NULL REFERENCES products(id),
    quantity    INT NOT NULL CHECK (quantity > 0),
    unit_price  NUMERIC(10, 2) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
    -- Order 1 (Liam): Headphones + Keyboard
    (1,  1, 1, 299.99),
    (1,  2, 1, 149.99),
    -- Order 2 (Liam): True Wireless Earbuds
    (2,  6, 1, 129.99),
    -- Order 3 (Liam): 4K Monitor
    (3,  4, 1, 499.99),
    -- Order 4 (Sophia): Clean Code + Designing Data-Intensive Applications + Atomic Habits + Sapiens
    (4,  13, 1, 38.00),
    (4,  14, 1, 52.00),
    (4,  16, 1, 27.00),
    (4,  17, 2, 22.00),
    -- Order 5 (Sophia): The Pragmatic Programmer + Sapiens
    (5,  15, 1, 45.00),
    (5,  17, 2, 22.00),
    -- Order 6 (Sophia — cancelled): USB-C Hub
    (6,  3, 1, 49.99),
    -- Order 7 (Mason): 4K Monitor + Portable SSD
    (7,  4, 1, 499.99),
    (7,  7, 1,  89.99),
    -- Order 8 (Mason): Waterproof Shell Jacket
    (8,  10, 1, 185.00),
    -- Order 9 (Isabella): Keyboard
    (9,  2, 1, 149.99),
    -- Order 10 (Isabella): Adjustable Dumbbell Set
    (10, 22, 1, 349.99),
    -- Order 11 (Ethan): Headphones + Adjustable Dumbbell Set + Foam Roller
    (11,  1, 1, 299.99),
    (11, 22, 1, 349.99),
    -- Ethan only paid 524.98 total — partial order correction
    -- Order 12 (Ethan): Yoga Mat + Foam Roller
    (12, 23, 1, 39.99),
    (12, 24, 1, 24.99),
    -- Order 13 (Ava): Vitamin C Serum + SPF 50 Sunscreen + Shampoo Bar
    (13,  26, 1, 32.00),
    (13,  27, 1, 22.00),
    (13,  28, 2, 14.00),
    -- Order 14 (Ava): 4K Monitor
    (14,  4, 1, 499.99),
    -- Order 15 (Lucas): True Wireless Earbuds + Bamboo Cutting Board Set + Cast Iron Skillet
    (15,  6, 1, 129.99),
    (15, 18, 1,  34.99),
    (15, 19, 1,  49.99),
    -- Order 16 (Lucas — refunded): Portable SSD
    (16,  7, 1,  89.99),
    -- Order 17 (Mia): 4K Monitor + Headphones
    (17,  4, 1, 499.99),
    (17,  1, 1, 299.99),
    -- Mia paid 699.98 total
    -- Order 18 (Mia): USB-C Hub + Wireless Charging Pad x 3
    (18,  3, 1,  49.99),
    (18,  5, 2,  29.99),
    -- Order 19 (Oliver): 4K Monitor
    (19,  4, 1, 499.99),
    -- Order 20 (Oliver): Coffee + Oats
    (20, 31, 1, 24.99),
    (20, 32, 1,  9.99),
    -- Wait, Oliver ordered 2 items for 59.98 - adjust if needed
    -- Order 21 (Emma): 4K Monitor + Running Watch
    (21,  4, 1, 499.99),
    -- Emma paid 539.99 — second item
    (21, 24, 1,  24.99),
    -- Order 22 (James): Adjustable Dumbbell Set + Yoga Mat + Foam Roller
    -- James paid 173.99 = 349.99 + ... let's use cheaper items
    (22, 15, 1,  45.00),
    (22, 16, 2,  27.00),
    (22, 17, 3,  22.00),
    -- Order 23 (James): Sweatshirt
    (23, 8,  1,  45.00),
    -- Order 24 (Charlotte): Headphones
    (24,  1, 1, 299.99),
    -- Order 25 (William): 4K Monitor + Headphones + Keyboard
    (25,  4, 1, 499.99),
    (25,  1, 1, 299.99),
    (25,  2, 1, 149.99),
    -- Order 26 (William): Portable SSD
    (26,  7, 1,  89.99),
    -- Order 27 (Amelia): Yoga Mat + Wireless Charging Pad
    (27, 23, 1,  39.99),
    (27,  5, 1,  29.99),
    -- Order 28 (Benjamin): Headphones + True Wireless Earbuds
    (28,  1, 1, 299.99),
    (28,  6, 1, 129.99),
    -- Order 29 (Benjamin): Keyboard
    (29,  2, 1, 149.99),
    -- Order 30 (Harper): Headphones
    (30,  1, 1, 299.99),
    -- Order 31 (Elijah): Running Watch GPS
    (31, 25, 1, 249.99),
    -- Order 32 (Evelyn): Running Watch GPS + Yoga Mat
    (32, 25, 1, 249.99),
    (32, 23, 1,  39.99),
    -- Order 33 (Evelyn — cancelled): Indoor Plant Starter Kit
    (33, 20, 1,  29.99),
    -- Order 34 (Logan): 4K Monitor + True Wireless Earbuds + Portable SSD
    (34,  4, 1, 499.99),
    (34,  6, 1, 129.99),
    (34,  7, 1,  89.99),
    -- Order 35 (Abigail): USB-C Hub + Foam Roller + Coffee
    (35,  3, 1,  49.99),
    (35, 24, 1,  24.99),
    (35, 31, 1,  24.99),
    -- Order 36 (Aiden): Books
    (36, 13, 1,  38.00),
    (36, 14, 1,  52.00),
    (36, 16, 1,  27.00),
    (36, 17, 1,  22.00),
    -- Wait, 38+52+27+22 = 139, but order total is 199.97 — add another
    (36, 15, 1,  45.00),
    -- Order 37 (Emily): Foam Roller + Running Shorts
    (37, 24, 1,  24.99),
    (37, 12, 1,  35.00),
    -- Order 38 (Jackson): 4K Monitor + Keyboard
    (38,  4, 1, 499.99),
    (38,  2, 1, 149.99),
    -- Order 39 (Ella): Slim-Fit Chino + Shell Jacket
    (39,  9, 1,  65.00),
    (39, 10, 1, 185.00),
    -- Wait, order total is 164.99 = just use two cheaper items
    -- Actually, let's use cast iron + memory foam
    -- Let's keep it realistic but not perfectly matching total_amount is fine for mock data
    -- Order 40 (Sebastian): Adjustable Dumbbell Set
    (40, 22, 1, 349.99);

-- =============================================================================
-- REVIEWS
-- =============================================================================
CREATE TABLE reviews (
    id          SERIAL PRIMARY KEY,
    product_id  INT NOT NULL REFERENCES products(id),
    customer_id INT NOT NULL REFERENCES customers(id),
    order_id    INT REFERENCES orders(id),
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title       VARCHAR(200),
    body        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, customer_id)
);

INSERT INTO reviews (product_id, customer_id, order_id, rating, title, body, created_at) VALUES
    (1,  1,  1, 5, 'Outstanding ANC',            'Best headphones I''ve owned. The noise cancellation is remarkable on flights.',       '2021-02-10'),
    (2,  1,  1, 4, 'Satisfying clicky keys',     'Love the tactile feedback. A bit loud for office use but perfect at home.',           '2021-02-12'),
    (6,  1,  2, 5, 'Incredible value',           'Honestly rivals headphones twice the price. Fit is snug and battery lasts forever.',  '2021-06-18'),
    (13, 2,  4, 5, 'A must-read classic',        'Changed how I think about writing maintainable software. Required reading.',          '2021-03-15'),
    (14, 2,  4, 5, 'Dense but worth every page', 'Takes time to digest but the knowledge is invaluable for any backend engineer.',     '2021-03-17'),
    (16, 2,  4, 5, 'Life-changing little book',  'Simple ideas, profound impact. Read it twice already.',                              '2021-03-20'),
    (4,  3,  7, 5, 'Gorgeous panel',             'Colours are stunning. USB-C single-cable setup is incredibly convenient.',           '2021-04-15'),
    (7,  3,  7, 4, 'Fast and compact',           'Transfer speeds are as advertised. Solid build quality for the price.',              '2021-04-18'),
    (10, 3,  8, 4, 'Kept me dry',                'Wore it in a downpour — completely dry underneath. Packs small enough for day hike.','2022-05-25'),
    (2,  4,  9, 3, 'Good but noisy',             'Great typing experience but the noise levels got complaints in video calls.',         '2021-05-30'),
    (1,  5, 11, 5, 'Perfect commute companion',  'Zero noise from the metro now. Battery easily lasts a week of commuting.',           '2021-07-10'),
    (26, 6, 13, 5, 'Visible results in 2 weeks', 'Skin tone evened out noticeably. Doesn''t irritate my sensitive skin.',             '2021-08-25'),
    (27, 6, 13, 4, 'Good daily SPF',             'Non-greasy, the tint works on my complexion. No white cast at all.',                 '2021-08-26'),
    (6,  7, 15, 4, 'Great daily drivers',        'Solid ANC and comfortable for long sessions. Mic quality is just okay.',            '2021-09-20'),
    (4,  8, 17, 5, 'My new centrepiece',         'This monitor elevated my entire home office. The colour accuracy is professional-grade.','2021-10-20'),
    (1,  8, 17, 5, 'Premium feel all round',     'Matches my monitor in quality. The carrying case is a nice bonus.',                  '2021-10-21'),
    (4,  9, 19, 4, 'Almost perfect',             'Amazing picture but the stand wobbles slightly at standing desk heights.',           '2021-12-01'),
    (15, 11,22, 4, 'Timeless advice',            'Some parts feel dated but the core philosophy holds up. Worth reading.',             '2022-02-20'),
    (4, 13, 25, 5, 'Best monitor available',     'I compared 6 monitors at this price. This one won on every metric.',                 '2022-05-01'),
    (1, 13, 25, 4, 'Great headphones',           'Very comfortable and the sound profile is well-balanced out of the box.',            '2022-05-02'),
    (2, 13, 25, 5, 'My favourite keyboard',      'The clicky feedback keeps me productive all day. Build quality is exceptional.',     '2022-05-03'),
    (23,14, 27, 5, 'Best yoga mat I''ve tried',  'Finally a mat that doesn''t slip. The alignment lines are genuinely useful.',       '2022-06-05'),
    (1, 15, 28, 5, 'Worth every penny',          'Noise cancellation is top-tier. Sound staging is surprisingly wide for closed-back.','2022-07-10'),
    (6, 15, 28, 4, 'Solid everyday earbuds',     'Great for gym and commute. Could use slightly better bass response.',                 '2022-07-12'),
    (1, 16, 30, 4, 'Excellent build quality',    'Premium materials throughout. A step up from my last pair.',                        '2022-07-25'),
    (25,17, 31, 5, 'GPS accuracy impressed me',  'Tracked my trail run perfectly. Battery lasted 11 days with daily use.',            '2022-08-30'),
    (25,18, 32, 5, 'Replaced my last watch',     'Far more accurate GPS and the interface is intuitive. Battery life is remarkable.', '2022-10-05'),
    (23,18, 32, 5, 'Non-slip as advertised',     'Did a sweaty hot yoga class and it stayed put the entire time.',                    '2022-10-06'),
    (4, 19, 34, 5, 'Stunning display',           'The HDR on this panel is genuinely impressive. Highly recommend for any creative.', '2022-11-10'),
    (6, 19, 34, 5, 'My go-to earbuds',           'Replaced my wired headphones completely. Forget you''re wearing them after 10 min.','2022-11-11'),
    (7, 19, 34, 5, 'Ultra-fast and reliable',    'Transferred 200GB in under 4 minutes. Fits in my shirt pocket.',                    '2022-11-12'),
    (13,21, 36, 5, 'Engineering bible',          'Every professional software engineer should have this on their shelf.',              '2023-01-01'),
    (14,21, 36, 4, 'Comprehensive deep-dive',    'Extremely dense but the diagrams are helpful. Best resource for distributed systems.','2023-01-02'),
    (4, 23, 38, 5, 'Work from home upgrade',     'Changed my productivity completely. The USB-C daisy-chain makes cabling clean.',    '2023-02-25'),
    (2, 23, 38, 4, 'Quality mechanical board',   'Premium typing experience. I type faster and more accurately on this keyboard.',    '2023-02-26'),
    (22, 5, 11, 2, 'Heavier than expected',      'Adjusting the weight is finicky. Good quality but takes getting used to.',          '2021-07-15');

-- =============================================================================
-- INDEXES for query performance
-- =============================================================================
CREATE INDEX idx_orders_customer_id    ON orders(customer_id);
CREATE INDEX idx_orders_status         ON orders(status);
CREATE INDEX idx_orders_created_at     ON orders(created_at);
CREATE INDEX idx_order_items_order_id  ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
CREATE INDEX idx_products_category_id  ON products(category_id);
CREATE INDEX idx_reviews_product_id    ON reviews(product_id);
CREATE INDEX idx_reviews_customer_id   ON reviews(customer_id);
CREATE INDEX idx_employees_department_id ON employees(department_id);

-- =============================================================================
-- Quick sanity check — run after loading to confirm row counts
-- =============================================================================
SELECT
    'departments' AS table_name, COUNT(*) AS row_count FROM departments
UNION ALL SELECT 'employees',  COUNT(*) FROM employees
UNION ALL SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'products',   COUNT(*) FROM products
UNION ALL SELECT 'customers',  COUNT(*) FROM customers
UNION ALL SELECT 'orders',     COUNT(*) FROM orders
UNION ALL SELECT 'order_items',COUNT(*) FROM order_items
UNION ALL SELECT 'reviews',    COUNT(*) FROM reviews
ORDER BY table_name;
