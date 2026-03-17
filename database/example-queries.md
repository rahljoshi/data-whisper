# Example Natural Language Queries for data-whisper

Use these to test the engine after loading `seed.sql`. Run via:

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "<question here>"}'
```

---

## Simple Lookups

| Question | Expected behaviour |
|---|---|
| `show me all customers` | SELECT * FROM customers LIMIT 100 |
| `list all active products` | WHERE is_active = true |
| `what categories do we have?` | SELECT * FROM categories |
| `show all employees in engineering` | JOIN departments, WHERE name = 'Engineering' |
| `find all cancelled orders` | WHERE status = 'cancelled' |

---

## Filtering & Sorting

| Question | Expected behaviour |
|---|---|
| `show products that cost more than $100` | WHERE price > 100 |
| `list products with less than 100 items in stock` | WHERE stock_quantity < 100 |
| `show the 5 cheapest products` | ORDER BY price ASC LIMIT 5 |
| `what are the 10 most expensive products?` | ORDER BY price DESC LIMIT 10 |
| `show customers who joined in 2022` | WHERE EXTRACT(YEAR FROM joined_at) = 2022 |
| `list orders placed in the last 6 months` | WHERE created_at >= NOW() - INTERVAL '6 months' |
| `show employees earning more than $80,000` | WHERE salary > 80000 |
| `find all shipped orders` | WHERE status = 'shipped' |

---

## Aggregations

| Question | Expected behaviour |
|---|---|
| `how many customers do we have?` | COUNT(*) FROM customers |
| `what is the total revenue from delivered orders?` | SUM(total_amount) WHERE status = 'delivered' |
| `what is the average order value?` | AVG(total_amount) FROM orders |
| `how many products are in each category?` | COUNT(*) GROUP BY category |
| `what is the average salary by department?` | AVG(salary) GROUP BY department |
| `how many orders does each status have?` | COUNT(*) GROUP BY status |
| `what is the total salary cost per department?` | SUM(salary) GROUP BY department |

---

## JOINs

| Question | Expected behaviour |
|---|---|
| `show me the top 10 customers by total order value` | JOIN orders, SUM GROUP BY customer |
| `which products have been ordered the most?` | JOIN order_items, COUNT/SUM GROUP BY product |
| `list all orders with customer names` | JOIN customers ON customer_id |
| `show products and their category names` | JOIN categories ON category_id |
| `which customers have never placed an order?` | LEFT JOIN orders, WHERE order_id IS NULL |
| `show each employee with their department name` | JOIN departments ON department_id |
| `what is the average review rating for each product?` | JOIN reviews, AVG(rating) GROUP BY product |
| `list the top 5 highest-rated products` | JOIN reviews, AVG rating ORDER BY rating DESC LIMIT 5 |
| `show me orders with the items they contain` | JOIN order_items ON order_id |

---

## Business Intelligence

| Question | Expected behaviour |
|---|---|
| `which category generates the most revenue?` | Multi-join: order_items → products → categories, SUM |
| `show me customers who have placed more than 2 orders` | GROUP BY customer HAVING COUNT > 2 |
| `what is the most popular product in the electronics category?` | Filter category + sum order_items quantity |
| `show me the total number of reviews per product with their average rating` | GROUP BY product, COUNT + AVG |
| `which customers gave us a 5-star review?` | JOIN reviews WHERE rating = 5 |
| `show the revenue generated each month in 2022` | GROUP BY EXTRACT(MONTH), WHERE YEAR = 2022 |
| `which employees were hired after 2021?` | WHERE hire_date > '2021-12-31' |
| `list products that have never been reviewed` | LEFT JOIN reviews, WHERE review IS NULL |
| `what is the total value of pending orders?` | SUM WHERE status = 'pending' |
| `show the best selling product by quantity sold` | SUM(quantity) FROM order_items GROUP BY product ORDER BY DESC |

---

## Edge Cases (should return EMPTY_RESULT or graceful response)

| Question | Expected behaviour |
|---|---|
| `show customers from Mars` | 0 rows returned |
| `list products in the "Furniture" category` | 0 rows (category doesn't exist in seed) |
| `find orders from 1990` | 0 rows |

---

## Security Tests (should be BLOCKED at AST level)

These should return `{ "error": { "type": "INVALID_SQL", ... } }`:

```bash
# These are questions that attempt to make the LLM generate mutation SQL
curl -X POST http://localhost:3000/api/query \
  -d '{"question": "delete all customers"}'

curl -X POST http://localhost:3000/api/query \
  -d '{"question": "drop the orders table"}'

curl -X POST http://localhost:3000/api/query \
  -d '{"question": "update all product prices to zero"}'
```

---

## Schema Reference

```
departments  (id, name, budget, created_at)
employees    (id, department_id, first_name, last_name, email, role, salary, hire_date, is_active)
categories   (id, name, description)
products     (id, category_id, name, description, price, stock_quantity, sku, is_active)
customers    (id, first_name, last_name, email, phone, city, country, joined_at, is_active)
orders       (id, customer_id, status, total_amount, shipping_city, created_at, shipped_at, delivered_at)
order_items  (id, order_id, product_id, quantity, unit_price)
reviews      (id, product_id, customer_id, order_id, rating, title, body, created_at)
```
