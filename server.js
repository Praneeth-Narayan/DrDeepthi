const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const Razorpay = require('razorpay');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

console.log("Razorpay key mode:", 
  process.env.RAZORPAY_KEY_ID 
    ? (process.env.RAZORPAY_KEY_ID.startsWith('rzp_live_') ? 'LIVE' : 'TEST') 
    : 'NOT FOUND');

app.use(cors());
app.use(bodyParser.json());

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const appointmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  reason: { type: String, trim: true },
  appointmentDate: { type: Date, required: true },
  appointmentTime: { type: String, required: true },
  paymentId: { type: String, required: true },
  amount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Appointment = mongoose.model('Appointment', appointmentSchema);

app.get('/api/appointments', async (req, res) => {
  try {
    const appointments = await Appointment.find();
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching appointments', error: err.message });
  }
});

app.post('/api/create-order', async (req, res) => {
  try {
    const options = {
      amount: req.body.amount,
      currency: req.body.currency || 'INR',
      receipt: 'receipt_' + Date.now(),
      payment_capture: 1
    };
    
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create order', error: error.message });
  }
});

app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const payload = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(payload)
      .digest('hex');

    const isValid = expectedSignature === razorpay_signature;

    if (isValid) {
      res.json({ verified: true });
    } else {
      res.status(400).json({ verified: false, message: 'Invalid payment signature' });
    }
  } catch (error) {
    res.status(500).json({ verified: false, message: 'Payment verification failed', error: error.message });
  }
});

app.post('/api/appointments', async (req, res) => {
  try {
    const { name, email, phone, reason, appointmentDate, appointmentTime, paymentId, amount } = req.body;
    
    if (!name || !email || !phone || !appointmentDate || !appointmentTime || !paymentId || !amount) {
      return res.status(400).json({ message: 'All required fields must be provided, including payment details' });
    }
    
    const normalizedDate = new Date(appointmentDate);
    normalizedDate.setHours(0, 0, 0, 0);
    
    const existingAppointment = await Appointment.findOne({
      appointmentDate: normalizedDate,
      appointmentTime
    });
    
    if (existingAppointment) {
      return res.status(409).json({ message: 'This time slot is already booked' });
    }
    
    const newAppointment = new Appointment({
      name, email, phone, reason, 
      appointmentDate: normalizedDate, 
      appointmentTime, paymentId, amount
    });

    await newAppointment.save();
    res.status(201).json({
      message: 'Appointment booked successfully',
      appointment: newAppointment
    });
  } catch (err) {
    res.status(500).json({ message: 'Error booking appointment', error: err.message });
  }
});

app.get('/api/payment/:paymentId', async (req, res) => {
  try {
    const payment = await razorpay.payments.fetch(req.params.paymentId);
    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch payment details', error: error.message });
  }
});

app.use((err, req, res, next) => {
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
