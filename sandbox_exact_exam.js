const { UEGraphExecutor } = require('./js/ue_engine.js');

const goldenJson = {
  "questions": {
    "Q1": {
      "title": "MCQ - Primary Organelle",
      "type": "logic",
      "total_marks": 4,
      "fatal_contradictions": ["mitochondria is primarily responsible", "nucleus is responsible"],
      "nodes": [
        {
          "concept": "Chloroplast",
          "weight": 4.0,
          "synonyms": ["B", "Chloroplasts"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    },
    "Q2": {
      "title": "MCQ - Primary Pigment",
      "type": "logic",
      "total_marks": 4,
      "fatal_contradictions": ["carotene is the primary", "xanthophyll is the primary"],
      "nodes": [
        {
          "concept": "Chlorophyll a",
          "weight": 4.0,
          "synonyms": ["C", "Chlorophyll-a"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    },
    "Q3": {
      "title": "MCQ - Light-dependent Location",
      "type": "logic",
      "total_marks": 4,
      "fatal_contradictions": ["occurs in stroma", "occurs in cytoplasm"],
      "nodes": [
        {
          "concept": "Thylakoid membrane",
          "weight": 4.0,
          "synonyms": ["C", "Thylakoids", "Grana"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    },
    "Q4": {
      "title": "MCQ - Gas Released",
      "type": "logic",
      "total_marks": 4,
      "fatal_contradictions": ["carbon dioxide is released", "nitrogen is released"],
      "nodes": [
        {
          "concept": "Oxygen",
          "weight": 4.0,
          "synonyms": ["C", "O2", "Oxygen gas"],
          "negation_triggers": ["not", "never", "sio", "ha", "absorb", "take in"]
        }
      ],
      "causal_patterns": []
    },
    "Q5": {
      "title": "MCQ - Splitting Water",
      "type": "logic",
      "total_marks": 4,
      "fatal_contradictions": ["hydrolysis", "oxidation of water"],
      "nodes": [
        {
          "concept": "Photolysis",
          "weight": 4.0,
          "synonyms": ["B", "Photolysis of water"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    },
    "Q6": {
      "title": "Definition of Photosynthesis",
      "type": "logic",
      "total_marks": 2,
      "fatal_contradictions": ["process of breaking down glucose", "respiration"],
      "nodes": [
        {
          "concept": "Synthesize organic compounds/glucose from carbon dioxide and water",
          "weight": 1.0,
          "synonyms": ["make food from CO2 and H2O", "produce sugar using carbon dioxide and water"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Using sunlight energy trapped by chlorophyll",
          "weight": 1.0,
          "synonyms": ["using light energy", "powered by solar energy", "absorb sunlight"],
          "negation_triggers": ["without light", "in the dark", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    },
    "Q7": {
      "title": "Raw Materials",
      "type": "logic",
      "total_marks": 2,
      "fatal_contradictions": ["oxygen is a raw material", "glucose is a raw material"],
      "nodes": [
        {
          "concept": "Carbon dioxide",
          "weight": 1.0,
          "synonyms": ["CO2"],
          "negation_triggers": ["not", "sio", "ha"]
        },
        {
          "concept": "Water",
          "weight": 1.0,
          "synonyms": ["H2O"],
          "negation_triggers": ["not", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    },
    "Q8": {
      "title": "Role of Chlorophyll",
      "type": "logic",
      "total_marks": 3,
      "fatal_contradictions": ["chlorophyll reflects all light", "chlorophyll produces water"],
      "nodes": [
        {
          "concept": "Absorbs light energy",
          "weight": 1.0,
          "synonyms": ["traps solar energy", "photoreceptor"],
          "negation_triggers": ["not", "never", "sio", "ha", "reflects"]
        },
        {
          "concept": "Converts solar energy into chemical energy by exciting electrons",
          "weight": 1.0,
          "synonyms": ["excites electrons", "generates chemical energy"],
          "negation_triggers": ["not", "sio", "ha"]
        },
        {
          "concept": "Drives light-dependent reactions",
          "weight": 1.0,
          "synonyms": ["powers the light stage"],
          "negation_triggers": ["light-independent", "dark stage", "sio", "ha"]
        }
      ],
      "causal_patterns": ["absorb.*light.*excite.*electron"]
    },
    "Q9": {
      "title": "Light-dependent vs Light-independent",
      "type": "logic",
      "total_marks": 4,
      "fatal_contradictions": ["light-dependent occurs in stroma", "light-independent requires direct light"],
      "nodes": [
        {
          "concept": "Light-dependent requires light, occurs in thylakoid, produces ATP/NADPH/O2",
          "weight": 2.0,
          "synonyms": ["light stage in grana making ATP and oxygen"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Light-independent does not require direct light, occurs in stroma, uses ATP/NADPH to fix CO2",
          "weight": 2.0,
          "synonyms": ["dark stage in stroma making glucose"],
          "negation_triggers": ["not", "never", "sio", "ha", "requires direct light"]
        }
      ],
      "causal_patterns": []
    },
    "Q10": {
      "title": "Factors Affecting Rate",
      "type": "logic",
      "total_marks": 3,
      "fatal_contradictions": ["oxygen concentration increases rate"],
      "nodes": [
        {
          "concept": "Light intensity",
          "weight": 1.0,
          "synonyms": ["sunlight intensity", "brightness"],
          "negation_triggers": ["not", "sio", "ha"]
        },
        {
          "concept": "Carbon dioxide concentration",
          "weight": 1.0,
          "synonyms": ["CO2 level", "amount of CO2"],
          "negation_triggers": ["not", "sio", "ha"]
        },
        {
          "concept": "Temperature",
          "weight": 1.0,
          "synonyms": ["heat level"],
          "negation_triggers": ["not", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    },
    "Q11": {
      "title": "Importance to Living Organisms",
      "type": "logic",
      "total_marks": 4,
      "fatal_contradictions": ["destroys food chains", "consumes oxygen making it unavailable"],
      "nodes": [
        {
          "concept": "Primary producer of organic food/energy",
          "weight": 2.0,
          "synonyms": ["base of food chains", "makes food for heterotrophs"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Releases oxygen for aerobic respiration",
          "weight": 2.0,
          "synonyms": ["provides O2 for breathing"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    },
    "Q12": {
      "title": "Role of Stomata",
      "type": "logic",
      "total_marks": 3,
      "fatal_contradictions": ["stomata absorb sunlight", "stomata are used for solid food intake"],
      "nodes": [
        {
          "concept": "Pores that facilitate gas exchange",
          "weight": 1.0,
          "synonyms": ["openings for gas diffusion"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Allow CO2 to enter",
          "weight": 1.0,
          "synonyms": ["carbon dioxide in"],
          "negation_triggers": ["prevent CO2", "sio", "ha"]
        },
        {
          "concept": "Allow O2 to exit",
          "weight": 1.0,
          "synonyms": ["oxygen out"],
          "negation_triggers": ["prevent O2", "sio", "ha"]
        }
      ],
      "causal_patterns": ["CO2.*enter", "O2.*exit"]
    },
    "Q13": {
      "title": "Balanced Chemical Equation",
      "type": "topology",
      "total_marks": 4,
      "fatal_contradictions": ["C6H12O6 is a reactant", "CO2 is a product"],
      "nodes": [
        {
          "concept": "Correct reactants",
          "weight": 1.0,
          "synonyms": ["6CO2 + 6H2O"],
          "negation_triggers": ["not", "sio", "ha"]
        },
        {
          "concept": "Correct products",
          "weight": 1.0,
          "synonyms": ["C6H12O6 + 6O2"],
          "negation_triggers": ["not", "sio", "ha"]
        },
        {
          "concept": "Correct balancing",
          "weight": 1.0,
          "synonyms": ["six CO2, six H2O, six O2"],
          "negation_triggers": ["unbalanced"]
        },
        {
          "concept": "Conditions specified",
          "weight": 1.0,
          "synonyms": ["Light + Chlorophyll over arrow"],
          "negation_triggers": ["missing conditions"]
        }
      ],
      "causal_patterns": ["6CO2.*\\+.*6H2O.*->.*C6H12O6.*\\+.*6O2"]
    },
    "Q16": {
      "title": "Chloroplast Structure and Function",
      "type": "logic",
      "total_marks": 16,
      "fatal_contradictions": ["chloroplast has no membrane", "stroma is for light-dependent"],
      "nodes": [
        {
          "concept": "Double membrane structure, stroma, thylakoids, grana, chlorophyll embedded, circular DNA",
          "weight": 6.0,
          "synonyms": ["outer inner membrane", "fluid stroma", "stacked thylakoids"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Thylakoid provides surface area for light absorption and site for light-dependent reactions",
          "weight": 2.0,
          "synonyms": ["light stage occurs here"],
          "negation_triggers": ["light-independent", "dark stage", "sio", "ha"]
        },
        {
          "concept": "Stroma contains enzymes and is site for Calvin cycle",
          "weight": 2.0,
          "synonyms": ["dark stage occurs here", "light-independent site"],
          "negation_triggers": ["light-dependent", "sio", "ha"]
        },
        {
          "concept": "Photoactivation, Photolysis of water, Electron Transport Chain, Chemiosmosis & Reduction",
          "weight": 6.0,
          "synonyms": ["light excites electrons", "water splits", "ATP and NADPH formed"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    },
    "Q17": {
      "title": "Calvin Cycle",
      "type": "logic",
      "total_marks": 14,
      "fatal_contradictions": ["Calvin cycle requires light directly", "Calvin cycle produces oxygen"],
      "nodes": [
        {
          "concept": "Carbon fixation: CO2 combines with RuBP catalyzed by Rubisco to form PGA",
          "weight": 3.0,
          "synonyms": ["fixes carbon into PGA"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Reduction: ATP and NADPH convert PGA into G3P",
          "weight": 3.0,
          "synonyms": ["PGA reduced to TP/G3P"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Regeneration: G3P leaves to make glucose, rest uses ATP to regenerate RuBP",
          "weight": 3.0,
          "synonyms": ["remakes RuBP"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "ATP provides chemical energy, NADPH acts as reducing agent for Calvin cycle",
          "weight": 5.0,
          "synonyms": ["energy currency and electron donor"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        }
      ],
      "causal_patterns": ["CO2.*RuBP.*PGA.*G3P"]
    },
    "Q26": {
      "title": "Essay - Foundation of Life",
      "type": "logic",
      "total_marks": 30,
      "fatal_contradictions": ["photosynthesis destroys life", "respiration creates energy from nothing"],
      "nodes": [
        {
          "concept": "Energy Base for Food Webs (converts solar to chemical)",
          "weight": 3.0,
          "synonyms": ["base of food chain"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Oxygen Production for aerobic respiration",
          "weight": 3.0,
          "synonyms": ["releases O2"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Ozone Layer Formation protecting from UV",
          "weight": 3.0,
          "synonyms": ["forms O3"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Carbon Sink / Climate Regulation",
          "weight": 3.0,
          "synonyms": ["removes CO2", "stops global warming"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Fossil Fuels formation from ancient organisms",
          "weight": 3.0,
          "synonyms": ["oil, coal, natural gas"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Photosynthesis and Respiration are biochemically reverse",
          "weight": 10.0,
          "synonyms": ["interrelated reverse processes", "products of one are reactants of other"],
          "negation_triggers": ["not related", "independent", "sio", "ha"]
        },
        {
          "concept": "Deforestation drops global photosynthesis, accelerates greenhouse effect",
          "weight": 5.0,
          "synonyms": ["cutting trees increases CO2"],
          "negation_triggers": ["deforestation helps", "improves ecosystems", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    },
    "Q27": {
      "title": "Application & Critical Thinking",
      "type": "logic",
      "total_marks": 20,
      "fatal_contradictions": ["plants eat soil", "dark room increases photosynthesis"],
      "nodes": [
        {
          "concept": "Incorrect because plants are autotrophs; soil only provides inorganic minerals and water, not organic food",
          "weight": 4.0,
          "synonyms": ["plants don't eat soil", "soil gives minerals only"],
          "negation_triggers": ["soil is food", "sio", "ha"]
        },
        {
          "concept": "Correct explanation: Plants manufacture their own food internally through photosynthesis using CO2 and light",
          "weight": 4.0,
          "synonyms": ["make own food", "autotrophic nutrition"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "In dark room, photosynthesis will completely stop",
          "weight": 3.0,
          "synonyms": ["halts", "ceases"],
          "negation_triggers": ["continues", "increases", "sio", "ha"]
        },
        {
          "concept": "Without light, no ATP/NADPH produced, halting Calvin cycle",
          "weight": 5.0,
          "synonyms": ["light-dependent stage fails", "no energy for dark stage"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        },
        {
          "concept": "Leaf adaptations: Broad lamina, thin structure, stomata presence, transparent cuticle",
          "weight": 4.0,
          "synonyms": ["flat surface", "large surface area", "pores"],
          "negation_triggers": ["not", "never", "sio", "ha"]
        }
      ],
      "causal_patterns": []
    }
  }
};

const studentAnswers = {
    "FullExam": `
1. Chloroplast
2. Chlorophyll a
3. Thylakoid membrane
4. Oxygen
5. Photolysis
6. Photosynthesis is basically when plants perform respiration to breathe in oxygen and make food from the soil.
7. Carbon dioxide and Water.
8. Light is absorbed by chlorophyll. It traps the sunlight.
9. Light-dependent requires light, occurs in thylakoid, produces ATP/NADPH/O2. Light-independent does not require direct light, occurs in stroma, uses ATP/NADPH to fix CO2.
10. Light intensity, Carbon dioxide concentration, Temperature.
11. It is the Primary producer of organic food/energy. Releases oxygen for aerobic respiration.
16. The chloroplast has an outer and inner membrane. It contains stroma and thylakoids. The thylakoid is for light reactions. But stroma does not contain enzymes. Also, it does not split water or make ATP.
26. It is the Energy Base for Food Webs. It provides Oxygen Production for aerobic respiration. It is a Carbon Sink / Climate Regulation. Fossil Fuels formation from ancient organisms. Photosynthesis and Respiration are biochemically reverse. Deforestation drops global photosynthesis, accelerates greenhouse effect. However, it does not form the Ozone Layer.
27. The claim that plants get food from soil is Incorrect because plants are autotrophs; soil only provides inorganic minerals and water, not organic food. Correct explanation: Plants manufacture their own food internally through photosynthesis using CO2 and light. In dark room, photosynthesis will completely stop. Without light, no ATP/NADPH produced, halting Calvin cycle. Leaf adaptations: Broad lamina, thin structure, stomata presence, transparent cuticle.
    `
};

async function runExactExamTest() {
    const engine = new UEGraphExecutor(goldenJson);
    const results = await engine.execute(studentAnswers);
    console.log(JSON.stringify(results, null, 2));
}

runExactExamTest();
