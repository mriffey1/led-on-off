# LED ON/OFF

### Status: *IN PROGRESS*

This is a Stream Deck plugin that allows you to go to a website such as http://localhost/on and http://localhost/off to turn on/off anything that is connected to an SBC or Microprocessor.

This project will coensign with using an ESP32 (to create the web server), a relay module, and a battery pack.

My LED sign is USB-A powered but I want the ability to be able to turn it on and off wirelessly. 

The ESP32 and the relay will cut and allow power to the sign using a web server with something like:

http://ledsign.local/on<br>
http://ledsign.local/off<br>
http://ledsign.local/toggle<br>
http://ledsign.local/status<br>

This stream deck plugin will allow you to press a button to open the website to send the status to turn on or off.

#### Both portions of the project are in progress.

#### This project still needs to be refactored and cleaned up.

### USE AT YOUR OWN RISK
