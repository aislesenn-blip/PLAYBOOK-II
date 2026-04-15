const { UEGraphExecutor } = require('./js/ue_engine.js');

// 1. Simulating the Golden JSON that the LLM Compiler generated from the Teacher's Marking Scheme
const goldenJson = {
    "questions": {
        "Q1_A_ii_Beneficial_Nutrients": {
            "title": "Beneficial Nutrients Definition",
            "type": "logic",
            "total_marks": 0.5,
            "fatal_contradictions": ["are essential", "required for growth"],
            "nodes": [
                { "concept": "do not meet the criteria of essentiality", "weight": 0.25, "synonyms": ["not essential"] },
                { "concept": "play beneficial roles in plant nutrition", "weight": 0.25, "synonyms": ["improve yield", "strengthen stems"] }
            ]
        },
        "Q1_B_i_Precision_Ag": {
            "title": "Precision Ag vs Tech",
            "type": "logic",
            "total_marks": 1.0,
            "nodes": [
                { "concept": "technologies employed to enhance productivity of crops and livestock", "weight": 0.5 },
                { "concept": "tools, instruments, machines to resolve human concerns", "weight": 0.5 }
            ]
        },
        "Q2_A_ii_Sensors": {
            "title": "Five Sensors in Precision Ag",
            "type": "logic",
            "total_marks": 2.5,
            "nodes": [
                { "concept": "Soil moisture sensor", "weight": 0.5, "synonyms": ["moisture content sensors"] },
                { "concept": "Soil pH sensor", "weight": 0.5, "synonyms": ["pH sensor"] },
                { "concept": "Nutrient sensor", "weight": 0.5, "synonyms": [] },
                { "concept": "Temperature sensor", "weight": 0.5, "synonyms": [] },
                { "concept": "Relative humidity sensor", "weight": 0.5, "synonyms": [] }
            ]
        },
        "Q6_B_i_Math_Loss": {
            "title": "Percentage Loss of Water (Math)",
            "type": "math",
            "total_marks": 5.5,
            "expected_answer": 1.8,
            "tolerance": 0.05,
            "target_variables": ["loss", "loss in water", "was", "="],
            "units": ["%", "was", "is", "1.8%"]
        },
        "Q6_B_ii_Math_Price": {
            "title": "Total Price of Maize (Math)",
            "type": "math",
            "total_marks": 8.0,
            "expected_answer": 9333310,
            "tolerance": 0.01,
            "target_variables": ["will pay", "pay", "Z =", "Tsh", "amount"],
            "units": ["/="]
        }
    }
};

// 2. The Raw text from the student you pasted (The whole thing as one big block)
const studentAnswers = {
    "FullExam": `
REGISTRATION NUMBER 2018-04-12551

06. Question
- Variable rate Technology is the only technology which deals with in field variabilities like Soil fertility, organic matter content and Soil Organic matters.

A. ii) There are three components of Variable rate Technology which are:
   a) Sensors
   b) Controllers
   c) Actuators

iii) Most common field variabilities that are related to land only are:
   a) Soil fertility
   b) Soil Organic matters content
   c) Soil texture
   d) Soil Moisture Content
   e) Soil color

--------------------------------------------------

REGISTRATION NUMBER 2018-04-12551

06. Question
A) iv) Five sensors used to monitor crops environment in Precision Agriculture:
   a) Pressure Sensors
   b) Grain flow
   c) Grain moisture
   d) Speed Sensors
   e) Grain loss sensors

B) Given Data:
   Yield Harvested = 20Mg
   Moisture Content on Harvest = 18%
   Loss harvest = 2Mg

   i) Percentage loss in water in grain when buyer arrived:
   Yield Remained = Yield harvested - Yield lost
   Yield Remained = 20Mg - 2Mg = 18Mg

   Now:
   20 Mg = 18%
   18 Mg = y
   y = (18 * 18%) / 20 Mg
   y = 16.2%

   Means for 18Mg remained with 16.2% MC.

--------------------------------------------------

6(B) i) Becomes:
   18% - 16.2% = 1.8%
   Loss in water within grain when buyer arrived was 1.8%.

ii) 1 bag of 100kg = 70,000 Tsh
   Required amount paid at MC of 12%.

   From: 18 Mg = 16.2%
   x = 12%
   x = (12% * 18 Mg) / 16.2
   x = 13.33 Mg will be sold.

   But 13.33 Mg = 13333 kg of maize. (Note: Student wrote 1333kg but calculation follows 133.33 bags)
   Number of bags = 13333 kg / 100 kg = 133.33 bags

   Price to pay = 133.33 bags * 70,000 Tsh
   Price to pay = 9,333,333.33 Tsh

   A buyer will pay 9,333,333.33 Tsh when maize is at 12% Moisture content.

--------------------------------------------------

03. Question
A i) Precision Agriculture is the application of technology within agriculture to increase productivity while decreasing cost of production. It involve use of Sensors, Satellite systems like GPS and DGPS, Agricultural machineries and electronic devices like Computers.

A ii) Challenges of Precision Agriculture:
   a) Perception and cultural beliefs of the users or Targeted people.
   b) Farm fragmentation.
   c) High initial cost and operation cost.
   d) Low network systems and bandwidth.
   e) It requires knowledge to operate the field.
   f) It requires skilled Labors to maintain or repair precision technology.
   g) Lack of technical experts.
   h) Poor electrical systems / Unreliable.

--------------------------------------------------

03. Question
(B) Reasons for adoption precision Agriculture:
   i) Easy / Reliable way to manage large farms - It is difficult for farmers to operate and manage very large farms taking example of 1000 hectare, but this method made easy way to control and operate each point of the farm from tillage to harvesting period through technology like Remote sensing and VRA.

   ii) Reduce cost of Production over a long run - Despite of high initial costs, when precision agriculture practised for several cropping seasons the yield obtained will be twice or thrice as normal. If you intend to get same yield output with other method (local), you would incur more cost of production.

   iii) Increase yield Productivity - In precision farming, we intend to reduce input to get same output, or same input and obtaining More output than intended or expected. Since all field variabilities are maintained (managed) and fertilizer and pesticide application is controlled.

--------------------------------------------------

(B) iv) Increase Efficiency - In precision farming, precise amount of fertilizers and insecticides will be applied where is needed and not applied where not required. During farm operations the crops will be managed without being physically damaged.

   v) Optimize the Use of scarce resources - In some areas water is very scarce, once available they need to be used efficiently to ensure no loss of water. Precision agriculture ensures these scarce resources are used in more efficient manner.

A) iii) Building blocks of Precision Agriculture:
   - Seed: In precision Agriculture seed sowing to required depth and seed handling is very crucial to get max yield. New highly production hybrid seeds are recommended.

--------------------------------------------------

02. Question
   - Fertilizer: Application of fertilizer on the field plays greater role in precision Agriculture. Precision farming ensures that the fertilizers is applied at required area, required time and at proper rate of application.

   - Pesticides: Precision Agriculture plays great role on identifying, detecting, and suggesting proper remedy for appeared pest diseases. Proper amount of pesticides will be applied without being overdosed or underdosed.

--------------------------------------------------

02. Question
A i) Remote Sensing is a technique used to control an object or area of interest without being physically contact with it. Ranges from few meters to thousand of Kilometres. Examples are RADAR and SPOT.

A ii) Five Sensors used to monitors crops environment in Precision farming:
   a) Grain flow sensors.
   b) Grain loss sensors.
   c) Speed sensors.
   d) Header Position sensors.
   e) Moisture content sensors.

A iii) Steps to accomplish applying remote sensing to site specific crop management:
   a) Collection
   b) Pre-processing
   c) Image analysis
   d) Ground validation / Verification
   e) Incorporation
   f) Identification
   g) Action

--------------------------------------------------

02. Question
B. i) Two types of Remote sensing:
   a) Active remote sensing - Is the one which emits its own signals or frequencies to an object and bounce it back to interprete data. Can be used at any time (day or night).
   b) Passive Remote Sensing - Is the one uses already reflected radiations from other sources like Sun. Can't be done at night.

--------------------------------------------------

02. Question
B. ii) Ways of acquiring an image by an electro-optical Sensors:
   a) Via Sensor - Method used to acquire image of the whole field at a time showing all interested data.
   b) Whisk broom sensor - Image is acquired by taking a small pixel at a time and move from side to side until the entire area of interest is finished.

--------------------------------------------------

02. Question
B. ii) c) Array (line) method - A swath of data within a line is taken at a time then moving to other end of the field. Several data obtained at a time after receiving reflected signals.

--------------------------------------------------

05. Question
A i) Global Positioning System is the technology which used to determine accurate location of an object or area of interest even when its moving. GPS uses older adequate Protocol.

A ii) Global Navigation Satellite System most applicable in Precision agriculture is GPS (USA), followed by GLONASS (Russia).

A iii) Working principle of Differential Global Positioning System (DGPS):
   Satellites transmit signals to both two receivers of DGPS (Rover and Base receiver). Rover attached to moving objects while Base (stationary) is attached at a tower of a known location as a benchmark. Base receiver modifies the position of moving machinery by sending differential radiations to the rover. DGPS corrects the location exactly.

--------------------------------------------------

05. Question
B) There are three types of Differential Global Positioning System which are:
   - SBAS
   - RTCM (accuracy ranges from 40-80 cm)
   - RTK (accuracy is below 20 cm)

--------------------------------------------------

01. Question
A i) Field invariabilities - Are those conditions of crop, soil and environment which does not change or does not vary within the field.

ii) Beneficial Nutrients - Are essential or important nutrients which are required for growth and production of the crop through entire phenological stage. Examples: Sodium (Na), Potassium (K), Calcium (Ca) and Phosphorus (P).

iii) Wicking system - Is a soilless farming technique in which nutrient solution is moving from tank to tray holding plants, through wicks and by capillarity action water reaches the roots.

iv) Aeroponics - Is a soilless farming technique of misting roots of a plant suspended on air. Sprayers provide nutrient solution direct to the roots.

--------------------------------------------------

01. Question
A v) Ebb and Flow - Soilless technique in which plants are flooded with nutrient for few hours and then water are drained to the tank (Reservoir).

B) Tofauti (Differences):
   i) Precision Agriculture is application of technology to increase productivity while reducing cost... WHILE Precision Technology is the technology which employ use of sensors and satellites.
   ii) Technology is an application of scientific knowledge in practical way... WHILE Science is exploring of new knowledge through observation and experiments.
   iii) GPS: technology used to determine position... WHILE GIS: method of identifying, collecting, storing and analyzing geographical data.

--------------------------------------------------

01. Question
B iv) Precision Agriculture - application of technology to increase productivity of both crops and animals... WHILE Precision Farming - application of technology principles of farming to increase productivity.
   v) Wicking system - nutrient moves through wick by capillarity... WHILE Hydroponic System - application of nutrient solution by working water through different methods.
   vi) Real Time Kinematics - part of DGPS which uses RTCM protocol... WHILE DGPS - technology providing accurate position through differential radiations between Stationary and Rover receiver.

--------------------------------------------------

01. Question
vii) Hydroponics - soilless farming cooperating working water supplying nutrients... WHILE Aquaponics - growing of aquatic animals and plants in a symbiotic way.
viii) GPS vs DGPS:
   - GPS: Has one receiver | DGPS: Has two receivers.
   - GPS: Frequency 1.1-1.5 GHz | DGPS: Frequency vary according to local user.
   - GPS: Provide position | DGPS: Provide realtime position.
   - GPS: Low cost compared to DGPS | DGPS: High cost compared to GPS.

ix) Nutrient Critical value - point below which a plant will be deficient of nutrient... WHILE Luxury Consumption - excess uptaking of nutrients exceeding that used for growth.

--------------------------------------------------

01. Question
x) Plants Nutrient optimal hunger - point at which a plant requires nutrients but doesn't show signs of deficit... WHILE Optimal Soil Nutrient Level - point at which nutrients are available for production and growth.

C) Areas of farming activities to employ principles of Precision farming:
   a) Tillage: Precision agriculture can show different soil conditions and at what depth should be tilled.
   b) Fertilizer Application: Machines and technology determine soil fertility and moisture content to control fertilization.

--------------------------------------------------

01. Question
   c) Spraying: Using aeroplanes, drones and boom sprayers to apply insecticides only where required.
   d) Crop Scouting: Through remote sensing and GPS, easy to control crop condition and suggest quick action via cameras and drones.
   e) Harvesting: Combine harvesters cut, feed, thresh and clean grain. Precision farming helps in preparing a yield map.
    `
};

async function runRealExamTest() {
    console.log("=========================================");
    console.log("  REAL UNIVERSITY EXAM GRADING INITIATED");
    console.log("=========================================\n");
    const engine = new UEGraphExecutor(goldenJson);

    const results = await engine.execute(studentAnswers);
    console.log(JSON.stringify(results, null, 2));
}

runRealExamTest();
