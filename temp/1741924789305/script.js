
// Initialize cart from localStorage
let cart = JSON.parse(localStorage.getItem('cart')) || [];

// Update cart count on page load
document.addEventListener('DOMContentLoaded', function() {
  updateCartDisplay();
  
  // Check if we're on the cart page
  const cartItems = document.getElementById('cart-items');
  if (cartItems) {
    renderCartItems();
  }
});

// Update cart display
function updateCartDisplay() {
  const cartCount = document.getElementById('cart-count');
  if (cartCount) {
    cartCount.textContent = cart.reduce((total, item) => total + item.quantity, 0);
  }
}

// Add item to cart
function addToCart(id, name, price) {
  // Check if item already exists
  const existingItem = cart.find(item => item.id === id);
  
  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cart.push({
      id: id,
      name: name,
      price: price,
      quantity: 1
    });
  }
  
  // Save to localStorage
  localStorage.setItem('cart', JSON.stringify(cart));
  
  // Update display
  updateCartDisplay();
  
  alert(`${name} added to cart!`);
}

// Render cart items on cart page
function renderCartItems() {
  const cartItems = document.getElementById('cart-items');
  if (!cartItems) return;
  
  // Clear existing items
  cartItems.innerHTML = '';
  
  if (cart.length === 0) {
    cartItems.innerHTML = '<p>Your cart is empty</p>';
    return;
  }
  
  // Calculate total
  let total = 0;
  
  // Add each item
  cart.forEach(item => {
    const itemTotal = item.price * item.quantity;
    total += itemTotal;
    
    const cartItem = document.createElement('div');
    cartItem.className = 'cart-item';
    cartItem.innerHTML = `
      <div>
        <h3>${item.name}</h3>
        <p>Quantity: ${item.quantity}</p>
      </div>
      <div>
        <p>$${item.price.toFixed(2)} each</p>
        <p><strong>$${itemTotal.toFixed(2)}</strong></p>
        <button onclick="removeFromCart(${item.id})">Remove</button>
      </div>
    `;
    
    cartItems.appendChild(cartItem);
  });
  
  // Add total
  const totalElement = document.createElement('div');
  totalElement.className = 'cart-total';
  totalElement.innerHTML = `<h2>Total: $${total.toFixed(2)}</h2>`;
  cartItems.appendChild(totalElement);
}

// Remove item from cart
function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartDisplay();
  
  // Re-render if on cart page
  const cartItems = document.getElementById('cart-items');
  if (cartItems) {
    renderCartItems();
  }
}
  