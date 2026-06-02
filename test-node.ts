const token = "w9xkGjNOaAV8v2lQybOQTCUpwIjMc_mPHiKki4zGZ9Jy4HxJVGwx0nY26oJ4dkC1tvaIdf69L3Jhy_K6lX-GUetSk6xPklYttez-w-_bHA_bgMMqVzLHXYqn7m-3qkawaVoBxM8ndtZ4c0z_btTf4zY5dBwDbNCdoIszTwSGg1km1LCn-vdaMBELCxoTewIiqyrXUsctp_jJgKxBB5DNe7oSLCZJq1Q8EzQnyxRuf4GZGFo6iQRfEn3oumnRUpxBdk1tDnZGzKifrlCRAVSAKDL3PcTi0qoodO4uhkZy2fyp5TrM1t5aKG7oAlEEkhVqjx7w2w";
const storeId = "dac8f0e2-01fd-426b-8f80-cba230084be2";

fetch("http://localhost:8888", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ amount: 315 })
}).catch(() => {});
