import type { Role } from '../fitting/doctrines';

export interface WtmDoctrine {
  name: string;
  fits: [Role, string, string][];
}

export const WTM_DOCTRINES: WtmDoctrine[] = [
  {
    name: 'WTM Incursion HQ DPS',
    fits: [
      ['dps', 'Optimal', `[Kronos, WTM Shield Kronos]
Auto Targeting System I
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Bastion Module I

Pithum B-Type Multispectrum Shield Hardener
Pithum B-Type Multispectrum Shield Hardener
Large Micro Jump Drive
Pith X-Type X-Large Shield Booster
Gist X-Type 500MN Microwarpdrive

Co-Processor II
Domination Tracking Enhancer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Syndicate Damage Control

Large Hybrid Burst Aerator II
Large EM Shield Reinforcer II

Federation Navy Hammerhead x5

Null L x20000
Void L x20000
Nanite Repair Paste x500
Synth Blue Pill Booster x5
Synth Drop Booster x5
Synth Frentix Booster x5
Agency 'Pyrolancea' DB3 Dose I x5
Agency 'Pyrolancea' DB7 Dose III x5`],
      ['dps', 'Optimal', `[Kronos, TLA Armor Kronos]
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Large Remote Armor Repairer II
Imperial Navy Large Remote Capacitor Transmitter
Bastion Module I

Large Micro Jump Drive
Shadow Serpentis Sensor Booster
Federation Navy Tracking Computer
Federation Navy Tracking Computer
Gist X-Type 500MN Microwarpdrive

Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Centum A-Type Multispectrum Energized Membrane
Centum A-Type Multispectrum Energized Membrane
Imperial Navy 1600mm Steel Plates

Large Trimark Armor Pump II
Large Hybrid Burst Aerator II

Damage Control II x1
Null L x20000
Void L x20000
Federation Navy Stasis Webifier x1
Optimal Range Script x2
Tracking Speed Script x2
Scan Resolution Script x1
Imperial Navy 1600mm Steel Plates x1
ECCM Script x1`],
      ['dps', 'Optimal', `[Paladin, WTM Shield Paladin]
Auto Targeting System I
Mega Pulse Laser II
Mega Pulse Laser II
Mega Pulse Laser II
Mega Pulse Laser II
Bastion Module I

Pithum B-Type Multispectrum Shield Hardener
Large Micro Jump Drive
Pith X-Type X-Large Shield Booster
Gist X-Type 500MN Microwarpdrive

Co-Processor II
Domination Tracking Enhancer
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Syndicate Damage Control

Large Energy Burst Aerator II
Large EM Shield Reinforcer II

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x2

Conflagration L x40
Scorch L x40
Small Tractor Beam I x1
Nanite Repair Paste x500
Synth Drop Booster x5
Synth Frentix Booster x5
Agency 'Pyrolancea' DB3 Dose I x5
Agency 'Pyrolancea' DB7 Dose III x5`],
      ['dps', 'Optimal', `[Paladin, TLA Armor Paladin]
Mega Pulse Laser II
Mega Pulse Laser II
Mega Pulse Laser II
Mega Pulse Laser II
Small Tractor Beam I
Large Remote Armor Repairer II
Imperial Navy Large Remote Capacitor Transmitter
Bastion Module I

Large Micro Jump Drive
Federation Navy Tracking Computer
Federation Navy Tracking Computer
Gist X-Type 500MN Microwarpdrive

Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Centum A-Type Multispectrum Energized Membrane
Centum A-Type Multispectrum Energized Membrane
Imperial Navy 1600mm Steel Plates

Large Trimark Armor Pump II
Large Energy Burst Aerator II

Conflagration L x40
Scorch L x40
Optimal Range Script x2
Tracking Speed Script x2`],
      ['dps', 'Optimal', `[Vargur, WTM Shield Vargur]
Auto Targeting System I
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
Bastion Module I

Pithum B-Type Multispectrum Shield Hardener
Pithum B-Type Multispectrum Shield Hardener
Large Micro Jump Drive
Federation Navy Tracking Computer
Pith X-Type X-Large Shield Booster
Gist X-Type 500MN Microwarpdrive

Domination Tracking Enhancer
Domination Tracking Enhancer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer

Large Projectile Ambit Extension I
Large Projectile Burst Aerator II

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x5

Barrage L x10000
Hail L x20000
Small Tractor Beam I x1
Nanite Repair Paste x500
Synth Sooth Sayer Booster x5
Optimal Range Script x1
Tracking Speed Script x1
Agency 'Pyrolancea' DB3 Dose I x5
Agency 'Pyrolancea' DB7 Dose III x5`],
      ['dps', 'Intermediate', `[Nightmare, WTM Shield Nightmare]
Mega Pulse Laser II
Mega Pulse Laser II
Mega Pulse Laser II
Mega Pulse Laser II
Small Tractor Beam I
Imperial Navy Large Remote Capacitor Transmitter

Pithum B-Type Multispectrum Shield Hardener
Large Micro Jump Drive
Federation Navy Tracking Computer
Federation Navy Tracking Computer
Gist X-Type 500MN Microwarpdrive
Sentient Sensor Booster
Republic Fleet Large Cap Battery

Domination Tracking Enhancer
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Syndicate Damage Control

Large EM Shield Reinforcer II
Large EM Shield Reinforcer II
Large Thermal Shield Reinforcer II

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x5

Conflagration L x40
Scorch L x40
Nanite Repair Paste x500
Synth Drop Booster x5
Synth Frentix Booster x5
Optimal Range Script x2
Tracking Speed Script x2
Scan Resolution Script x1
Agency 'Pyrolancea' DB3 Dose I x5
Agency 'Pyrolancea' DB7 Dose III x5`],
      ['dps', 'Intermediate', `[Vindicator, WTM Shield Vindicator]
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II

Pithum B-Type Multispectrum Shield Hardener
Federation Navy Stasis Webifier
Federation Navy Stasis Webifier
Federation Navy Stasis Webifier
Gist X-Type 500MN Microwarpdrive

Domination Tracking Enhancer
Domination Tracking Enhancer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Syndicate Damage Control

Large EM Shield Reinforcer II
Large EM Shield Reinforcer II
Large Thermal Shield Reinforcer II

Federation Navy Hammerhead x10

Large Micro Jump Drive x1
Null L x10000
Void L x10000
Federation Navy Antimatter Charge L x10000
Nanite Repair Paste x500
Synth Drop Booster x5
Synth Frentix Booster x5
Agency 'Pyrolancea' DB3 Dose I x5
Agency 'Pyrolancea' DB7 Dose III x5`],
      ['dps', 'Intermediate', `[Vindicator, TLA Armor Vindicator]
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II

Federation Navy Stasis Webifier
Federation Navy Stasis Webifier
Federation Navy Stasis Webifier
Federation Navy Stasis Webifier
Core X-Type 500MN Microwarpdrive

Damage Control II
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Republic Fleet Tracking Enhancer
Imperial Navy 1600mm Steel Plates

Large Hyperspatial Velocity Optimizer I
Large Hybrid Locus Coordinator II
Large Hybrid Metastasis Adjuster II

Large Micro Jump Drive x1
Null L x5000
Void L x15000
Federation Navy Antimatter Charge L x10000
Imperial Navy 1600mm Steel Plates x2`],
      ['dps', 'Intermediate', `[Machariel, WTM Shield Machariel]
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
Small Tractor Beam I

Pithum B-Type Multispectrum Shield Hardener
Large Micro Jump Drive
Federation Navy Tracking Computer
Federation Navy Tracking Computer
Gist X-Type 500MN Microwarpdrive
Sentient Sensor Booster

Domination Tracking Enhancer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Syndicate Damage Control

Large EM Shield Reinforcer II
Large EM Shield Reinforcer II
Large Thermal Shield Reinforcer II

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x10

Barrage L x10000
Hail L x10000
Nanite Repair Paste x500
Synth Drop Booster x5
Synth Frentix Booster x5
Optimal Range Script x2
Tracking Speed Script x2
Scan Resolution Script x1
Agency 'Pyrolancea' DB3 Dose I x5
Agency 'Pyrolancea' DB7 Dose III x5`],
      ['dps', 'Intermediate', `[Golem, WTM Shield Golem]
Auto Targeting System I
Torpedo Launcher II
Torpedo Launcher II
Torpedo Launcher II
Torpedo Launcher II
Bastion Module I

Pithum B-Type Multispectrum Shield Hardener
Pithum B-Type Multispectrum Shield Hardener
Large Micro Jump Drive
Pith X-Type X-Large Shield Booster
Gist X-Type 500MN Microwarpdrive
Republic Fleet Target Painter
Missile Guidance Computer II

Caldari Navy Ballistic Control System
Caldari Navy Ballistic Control System
Caldari Navy Ballistic Control System
Caldari Navy Ballistic Control System

Large Bay Loading Accelerator II
Large EM Shield Reinforcer II

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x5

Inferno Rage Torpedo x10000
Inferno Javelin Torpedo x10000
Synth Crash Booster x5
Missile Range Script x1
Missile Precision Script x1
Small Tractor Beam I x1
Agency 'Pyrolancea' DB3 Dose I x5
Agency 'Pyrolancea' DB7 Dose III x5`],
      ['dps', 'Starter', `[Apocalypse Navy Issue, ER Armor Apocalypse Navy Issue]
Damage Control II
Heat Sink II
Heat Sink II
Multispectrum Energized Membrane II
Multispectrum Energized Membrane II
Centum C-Type Kinetic Energized Membrane
Corpum C-Type Explosive Energized Membrane
Imperial Navy 1600mm Steel Plates

Tracking Computer II
Large Compact Pb-Acid Cap Battery
Alumel-Wired Enduring Sensor Booster
500MN Quad LiF Restrained Microwarpdrive

Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I

Large Thermal Armor Reinforcer I
Large Hyperspatial Velocity Optimizer I
Large Energy Discharge Elutriation II

Federation Navy Hammerhead x5

Large Micro Jump Drive x1
Imperial Navy Multifrequency L x40
Imperial Navy Xray L x16
Nanite Repair Paste x500
Synth Mindflood Booster x2
Optimal Range Script x1
Tracking Speed Script x1
Scan Resolution Script x1`],
      ['dps', 'Starter', `[Apocalypse Navy Issue, WTM Shield Apocalypse Navy]
Damage Control II
Heat Sink II
Heat Sink II
Heat Sink II
Capacitor Power Relay II
Capacitor Power Relay II
Power Diagnostic System II
Power Diagnostic System II

500MN Quad LiF Restrained Microwarpdrive
Republic Fleet Large Cap Battery
Multispectrum Shield Hardener II
Multispectrum Shield Hardener II

Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I

Large Thermal Shield Reinforcer II
Large EM Shield Reinforcer II
Large EM Shield Reinforcer II

Federation Navy Hobgoblin x10
Federation Navy Hammerhead x5

Imperial Navy Multifrequency L x32
Imperial Navy Xray L x24`],
      ['dps', 'Starter', `[Megathron, ER Armor Megathron]
Damage Control II
Magnetic Field Stabilizer II
Magnetic Field Stabilizer II
Magnetic Field Stabilizer II
Multispectrum Energized Membrane II
Multispectrum Energized Membrane II
Centum C-Type Explosive Energized Membrane
Imperial Navy 1600mm Steel Plates

Tracking Computer II
Tracking Computer II
Large Compact Pb-Acid Cap Battery
500MN Quad LiF Restrained Microwarpdrive

Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I

Large Kinetic Armor Reinforcer I
Large Thermal Armor Reinforcer I
Large Hyperspatial Velocity Optimizer I

Federation Navy Hammerhead x5

Large Micro Jump Drive x1
Federation Navy Antimatter Charge L x20000
Federation Navy Tungsten Charge L x10000
Nanite Repair Paste x500
Synth Mindflood Booster x2
Optimal Range Script x2
Tracking Speed Script x2`],
      ['dps', 'Starter', `[Megathron, WTM Shield Megathron]
Damage Control II
Magnetic Field Stabilizer II
Magnetic Field Stabilizer II
Magnetic Field Stabilizer II
Capacitor Power Relay II
Tracking Enhancer II
Tracking Enhancer II
Capacitor Power Relay II

Multispectrum Shield Hardener II
Multispectrum Shield Hardener II
500MN Quad LiF Restrained Microwarpdrive
Republic Fleet Large Cap Battery

Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I

Large Thermal Shield Reinforcer II
Large EM Shield Reinforcer II
Large EM Shield Reinforcer II

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x5

Federation Navy Tungsten Charge L x15000
Federation Navy Antimatter Charge L x15060`],
      ['dps', 'Starter', `[Tempest, WTM Shield Tempest]
Damage Control II
Gyrostabilizer II
Gyrostabilizer II
Gyrostabilizer II
Tracking Enhancer II
Capacitor Power Relay II

Multispectrum Shield Hardener II
Multispectrum Shield Hardener II
500MN Quad LiF Restrained Microwarpdrive
Republic Fleet Large Cap Battery
Tracking Computer II

800mm Heavy 'Scout' Repeating Cannon I
800mm Heavy 'Scout' Repeating Cannon I
800mm Heavy 'Scout' Repeating Cannon I
800mm Heavy 'Scout' Repeating Cannon I
800mm Heavy 'Scout' Repeating Cannon I
800mm Heavy 'Scout' Repeating Cannon I
Large Radiative Scoped Remote Capacitor Transmitter
Small Tractor Beam I

Large Thermal Shield Reinforcer II
Large EM Shield Reinforcer II
Large EM Shield Reinforcer II

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x5

Tracking Speed Script x1
Republic Fleet Phased Plasma L x12000
Republic Fleet EMP L x13440
Optimal Range Script x1`],
    ],
  },
  {
    name: 'WTM Incursion HQ Logi',
    fits: [
      ['logi', '', `[Scimitar, WTM Shield Scimitar L5 Links]
Large Remote Shield Booster II
Large Remote Shield Booster II
Large Remote Shield Booster II
Large Remote Shield Booster II

Shadow Serpentis Remote Tracking Computer
Shadow Serpentis Remote Tracking Computer
Shadow Serpentis Remote Tracking Computer
Shadow Serpentis Remote Tracking Computer
Federation Navy 10MN Afterburner

Damage Control II
Dark Blood Capacitor Power Relay
Dark Blood Capacitor Power Relay
Dark Blood Capacitor Power Relay

Medium Ancillary Current Router II
Medium Capacitor Control Circuit II

Federation Navy Hobgoblin x5
Medium Armor Maintenance Bot I x1
Medium Hull Maintenance Bot I x1

Multispectrum Shield Hardener II x1
Nanite Repair Paste x500
Synth Mindflood Booster x5
Optimal Range Script x4
Tracking Speed Script x4`],
      ['logi', '', `[Scimitar, WTM Shield Scimitar L5 Standard]
Large Remote Shield Booster II
Large Remote Shield Booster II
Large Remote Shield Booster II
Large Remote Shield Booster II

Multispectrum Shield Hardener II
Shadow Serpentis Remote Tracking Computer
Shadow Serpentis Remote Tracking Computer
Shadow Serpentis Remote Tracking Computer
Federation Navy 10MN Afterburner

Capacitor Power Relay II
Capacitor Power Relay II
Capacitor Power Relay II
Capacitor Power Relay II

Medium Ancillary Current Router II
Medium Capacitor Control Circuit II

Medium Armor Maintenance Bot I x1
Federation Navy Hobgoblin x5
Medium Hull Maintenance Bot I x1

Damage Control II x1
Nanite Repair Paste x500
Synth Mindflood Booster x5
Optimal Range Script x3
Tracking Speed Script x3`],
      ['logi', '', `[Basilisk, WTM Shield Basilisk L5]
Large Remote Shield Booster II
Large Remote Shield Booster II
Large Remote Shield Booster II
Large Remote Shield Booster II
Large Remote Capacitor Transmitter II
Large Remote Capacitor Transmitter II

Pithum C-Type Multispectrum Shield Hardener
True Sansha Cap Recharger
Gistum B-Type 10MN Afterburner
Pith X-Type EM Shield Hardener
Republic Fleet Large Cap Battery

True Sansha Power Diagnostic System
True Sansha Power Diagnostic System

Medium Ancillary Current Router II
Medium Capacitor Control Circuit II

Federation Navy Hobgoblin x5

Nanite Repair Paste x500
Synth Mindflood Booster x5`],
      ['logi', '', `[Loki, WTM Shield Loki]
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster

Pithum C-Type Multispectrum Shield Hardener
Pithum C-Type Multispectrum Shield Hardener
Gistum C-Type 50MN Microwarpdrive
Caldari Navy Large Shield Extender
Republic Fleet Large Cap Battery

Capacitor Power Relay II
Capacitor Power Relay II
Capacitor Power Relay II
Signal Amplifier II

Medium Capacitor Control Circuit II
Medium Capacitor Control Circuit II
Medium Core Defense Field Extender II

Loki Defensive - Covert Reconfiguration
Loki Offensive - Support Processor
Loki Propulsion - Wake Limiter
Loki Core - Augmented Nuclear Reactor

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x2

Nanite Repair Paste x500
Synth Mindflood Booster x5`],
      ['logi', '', `[Loki, TLA Armor Loki]
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster

Imperial Navy Cap Recharger
Corelum C-Type 50MN Microwarpdrive
Republic Fleet Large Cap Battery

Damage Control II
True Sansha Capacitor Power Relay
True Sansha Capacitor Power Relay
Centii A-Type Multispectrum Coating
Centii A-Type Multispectrum Coating
Imperial Navy 800mm Steel Plates

Medium Explosive Armor Reinforcer II
Medium Trimark Armor Pump II
Medium Capacitor Control Circuit II

Loki Defensive - Covert Reconfiguration
Loki Offensive - Support Processor
Loki Propulsion - Intercalated Nanofibers
Loki Core - Augmented Nuclear Reactor

Nanite Repair Paste x500`],
      ['logi', '', `[Nestor, WTM Shield Nestor]
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer

Pithum B-Type Multispectrum Shield Hardener
Pithum B-Type Multispectrum Shield Hardener
Shadow Serpentis Sensor Booster
Pithum A-Type EM Shield Amplifier
Core X-Type 500MN Microwarpdrive
Republic Fleet Large Cap Battery

Dark Blood Capacitor Power Relay
Dark Blood Capacitor Power Relay
Dark Blood Capacitor Power Relay
Dark Blood Capacitor Power Relay
Dark Blood Capacitor Power Relay
Syndicate Damage Control

Large Remote Repair Augmentor II
Large Remote Repair Augmentor II
Large Hyperspatial Velocity Optimizer II

Heavy Armor Maintenance Bot I x5
Federation Navy Hammerhead x20

Nanite Repair Paste x500
Scan Resolution Script x1`],
      ['logi', '', `[Nestor, TLA Armor Nestor]
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer

Imperial Navy Cap Recharger
Imperial Navy Cap Recharger
Core X-Type 500MN Microwarpdrive
Shadow Serpentis Sensor Booster
Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery

Imperial Navy Capacitor Power Relay
Imperial Navy Capacitor Power Relay
Centum A-Type Multispectrum Energized Membrane
Centum A-Type Multispectrum Energized Membrane
Imperial Navy 1600mm Steel Plates
Syndicate Damage Control

Large Remote Repair Augmentor II
Large Remote Repair Augmentor II
Large Hyperspatial Velocity Optimizer II

Heavy Armor Maintenance Bot II x5
Federation Navy Hammerhead x20

Nanite Repair Paste x500
Scan Resolution Script x1
Imperial Navy 1600mm Steel Plates x1
ECCM Script x1`],
    ],
  },
  {
    name: 'WTM Incursion HQ Support',
    fits: [
      ['boost', '', `[Claymore, WTM Primary]
Shadow Serpentis Damage Control
Caldari Navy Power Diagnostic System
Caldari Navy Power Diagnostic System
Caldari Navy Power Diagnostic System

Gistum B-type 50mn Microwarpdrive
Pithum A-Type Multispectrum Shield Hardener
Caldari Navy Large Shield Extender
Shadow Serpentis Remote Sensor Booster
Shadow Serpentis Remote Sensor Booster
Pithum A-Type Multispectrum Shield Hardener

Shield Command Burst II
Shield Command Burst II
Shield Command Burst II
Skirmish Command Burst II
Small Murky Compact Remote Shield Booster
Auto Targeting System II
Small Tractor Beam II

Medium Command Processor I
Medium Command Processor I

'Augmented' Hammerhead x5
'Augmented' Hobgoblin x5

Active Shielding Charge x1200
Shield Harmonizing Charge x1200
Shield Extension Charge x1200
Scan Resolution Script x2
Rapid Deployment Charge x1200
Evasive Maneuvers Charge x1200
Shadow Serpentis Remote Tracking Computer x2
Nanite Repair Paste x250
Tracking Speed Script x2
Optimal Range Script x2`],
      ['boost', '', `[Damnation, Damnation]
Imperial Navy 1600mm Steel Plates
Imperial Navy 800mm Steel Plates
Syndicate Damage Control
Centum A-Type Multispectrum Energized Membrane
Centum A-Type Multispectrum Energized Membrane
Centum A-Type Thermal Energized Membrane

Gistum B-Type 50MN Microwarpdrive
Medium Micro Jump Drive
Shadow Serpentis Remote Tracking Computer
Shadow Serpentis Remote Tracking Computer

Armor Command Burst II
Armor Command Burst II
Armor Command Burst II
Skirmish Command Burst II
Small Murky Compact Remote Shield Booster

Medium Command Processor I
Medium Command Processor I

Acolyte I x10

Optimal Range Script x2
Tracking Speed Script x2
Armor Energizing Charge x2000
Rapid Repair Charge x2000
Armor Reinforcement Charge x2000
Interdiction Maneuvers Charge x2000
Rapid Deployment Charge x2000`],
      ['boost', '', `[Eos, WTM Armor Eos]
Small Murky Compact Remote Shield Booster
Armor Command Burst II
Armor Command Burst II
Armor Command Burst II
Skirmish Command Burst II

Gistum A-Type 50MN Microwarpdrive
Sentient Remote Sensor Booster
Sentient Remote Sensor Booster
Sentient Remote Sensor Booster

Centii A-Type Multispectrum Coating
Centii A-Type Multispectrum Coating
Corpum A-Type Explosive Energized Membrane
Centum A-Type Multispectrum Energized Membrane
Imperial Navy 1600mm Steel Plates
Imperial Navy Drone Damage Amplifier
Syndicate Damage Control

Medium Command Processor I
Medium Command Processor I

Federation Navy Hammerhead x10
Medium Hull Maintenance Bot II x5

Small Tractor Beam II x1
Nanite Repair Paste x1000
Targeting Range Script x3
Scan Resolution Script x3
Medium Micro Jump Drive x1
ECCM Script x3
Armor Energizing Charge x1900
Rapid Repair Charge x1900
Armor Reinforcement Charge x1900
Interdiction Maneuvers Charge x1900`],
      ['scout', '', `[Atron, super cheap scout]
Nanofiber Internal Structure I
Nanofiber Internal Structure I
Nanofiber Internal Structure I

5MN Quad LiF Restrained Microwarpdrive
Type-E Enduring Cargo Scanner
Ta3 Compact Ship Scanner

Small Asymmetric Enduring Remote Shield Booster
Prototype Cloaking Device I

Small Hyperspatial Velocity Optimizer I
Small Hyperspatial Velocity Optimizer I
Small Hyperspatial Velocity Optimizer I`],
    ],
  },
  {
    name: 'WTM Incursion Vanguard DPS',
    fits: [
      ['dps', 'Optimal', `[Kronos, ER VG Kronos Basic]
Damage Control II
Magnetic Field Stabilizer II
Magnetic Field Stabilizer II
Imperial Navy Multispectrum Energized Membrane
Imperial Navy Multispectrum Energized Membrane
Corpus X-Type Large Armor Repairer
Imperial Navy 1600mm Steel Plates

Tracking Computer II
Tracking Computer II
Tracking Computer II
Sensor Booster II
Sensor Booster II

Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Large Remote Armor Repairer II
Imperial Navy Large Remote Capacitor Transmitter
Bastion Module I

Large Trimark Armor Pump II
Large Hyperspatial Velocity Optimizer II

Medium Hull Maintenance Bot I x5
Imperial Navy Acolyte x5

Optimal Range Script x3
Tracking Speed Script x3
Federation Navy Tungsten Charge L x10000
Federation Navy Antimatter Charge L x20000
Scan Resolution Script x2
Nanite Repair Paste x500`],
      ['dps', 'Optimal', `[Kronos, ER VG Kronos Elite]
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Corpum A-Type Multispectrum Energized Membrane
Corpum A-Type Multispectrum Energized Membrane
Corpus X-Type Large Armor Repairer
Imperial Navy 1600mm Steel Plates

Shadow Serpentis Tracking Computer
Shadow Serpentis Tracking Computer
Shadow Serpentis Tracking Computer
Sentient Sensor Booster
Sentient Sensor Booster

Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Large Remote Armor Repairer II
Imperial Navy Large Remote Capacitor Transmitter
Bastion Module I

Large Trimark Armor Pump II
Large Hybrid Burst Aerator II

Medium Hull Maintenance Bot I x5
Imperial Navy Acolyte x5

Null L x10000
Void L x20000
Optimal Range Script x3
Tracking Speed Script x3
Scan Resolution Script x2`],
      ['dps', 'Optimal', `[Kronos, WTM VG Shield Kronos]
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Pithum A-Type Medium Remote Shield Booster
Bastion Module I

Pithum B-Type Multispectrum Shield Hardener
Federation Navy Tracking Computer
Pith X-Type X-Large Shield Booster
Federation Navy Tracking Computer
Sentient Sensor Booster

Domination Tracking Enhancer
Domination Tracking Enhancer
Domination Tracking Enhancer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer

Large Hybrid Burst Aerator II
Large EM Shield Reinforcer II

Acolyte II x5
Federation Navy Garde x2

Null L x1
Federation Navy Antimatter Charge L x1
Optimal Range Script x1
Tracking Speed Script x1
Scan Resolution Script x2`],
      ['dps', 'Optimal', `[Paladin, ER VG Paladin Basic]
Damage Control II
Imperial Navy Multispectrum Energized Membrane
Imperial Navy Multispectrum Energized Membrane
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Corpus X-Type Large Armor Repairer
Imperial Navy 1600mm Steel Plates

Sensor Booster II
Sensor Booster II
Tracking Computer II
Tracking Computer II

Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Large Remote Armor Repairer II
Large Remote Armor Repairer II
Imperial Navy Large Remote Capacitor Transmitter
Bastion Module I

Large Trimark Armor Pump II
Large Energy Burst Aerator II

Imperial Navy Acolyte x5
Medium Hull Maintenance Bot I x5

Imperial Navy Multifrequency L x32
Imperial Navy Xray L x16
Optimal Range Script x2
Tracking Speed Script x2
Scan Resolution Script x2
Nanite Repair Paste x500`],
      ['dps', 'Optimal', `[Paladin, ER VG Paladin Elite]
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Corpum A-Type Multispectrum Energized Membrane
Corpum A-Type Multispectrum Energized Membrane
Corpus X-Type Large Armor Repairer
Imperial Navy 1600mm Steel Plates

Shadow Serpentis Tracking Computer
Shadow Serpentis Tracking Computer
Sentient Sensor Booster
Sentient Sensor Booster

Mega Pulse Laser II
Mega Pulse Laser II
Mega Pulse Laser II
Mega Pulse Laser II
Large Remote Armor Repairer II
Large Remote Armor Repairer II
Imperial Navy Large Remote Capacitor Transmitter
Bastion Module I

Large Trimark Armor Pump II
Large Energy Burst Aerator II

Light Hull Maintenance Bot I x5
Imperial Navy Acolyte x5

Conflagration L x40
Scorch L x40
Imperial Navy Multifrequency L x20
Optimal Range Script x2
Tracking Speed Script x2
Scan Resolution Script x2`],
      ['dps', 'Optimal', `[Paladin, WTM VG Shield Paladin]
Mega Pulse Laser II
Mega Pulse Laser II
Mega Pulse Laser II
Mega Pulse Laser II
Bastion Module I

Pithum B-Type Multispectrum Shield Hardener
Federation Navy Tracking Computer
Pith X-Type X-Large Shield Booster
Sentient Sensor Booster

Domination Tracking Enhancer
Domination Tracking Enhancer
Domination Tracking Enhancer
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink

Large Energy Burst Aerator II
Large EM Shield Reinforcer II

Acolyte II x5
Federation Navy Garde x1

Conflagration L x1
Scorch L x1
Imperial Navy Multifrequency L x1
Tracking Speed Script x1
Scan Resolution Script x1`],
      ['dps', 'Optimal', `[Vargur, ER VG Vargur Elite]
Damage Control II
Domination Gyrostabilizer
Domination Gyrostabilizer
Domination Gyrostabilizer
Domination Gyrostabilizer
Domination Tracking Enhancer

Pithum A-Type Multispectrum Shield Hardener
Shadow Serpentis Tracking Computer
Shadow Serpentis Tracking Computer
Gist X-Type X-Large Shield Booster
Shadow Serpentis Sensor Booster
Shadow Serpentis Sensor Booster

Auto Targeting System I
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
Pithum A-Type Medium Remote Shield Booster
Bastion Module I

Large Projectile Ambit Extension I
Large Projectile Burst Aerator II

Medium Hull Maintenance Bot I x5
Imperial Navy Acolyte x5

Tracking Speed Script x2
Scan Resolution Script x2
Hail L x20480
Nanite Repair Paste x1000
Optimal Range Script x2`],
      ['dps', 'Optimal', `[Vargur, ER VG Vargur Elite]
Damage Control II
Domination Gyrostabilizer
Domination Gyrostabilizer
Domination Gyrostabilizer
Domination Gyrostabilizer
Domination Tracking Enhancer

Pithum A-Type Multispectrum Shield Hardener
Shadow Serpentis Tracking Computer
Shadow Serpentis Tracking Computer
Gist X-Type X-Large Shield Booster
Shadow Serpentis Sensor Booster
Shadow Serpentis Sensor Booster

Auto Targeting System I
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
Pithum A-Type Medium Remote Shield Booster
Bastion Module I

Large Projectile Ambit Extension I
Large Projectile Burst Aerator II

Imperial Navy Acolyte x5
Medium Hull Maintenance Bot I x5

Hail L x20480
Nanite Repair Paste x1000
Optimal Range Script x2
Tracking Speed Script x2
Scan Resolution Script x2`],
      ['dps', 'Optimal', `[Vargur, WTM VG Shield Vargur]
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Bastion Module I

Pithum B-Type Multispectrum Shield Hardener
Federation Navy Tracking Computer
Federation Navy Tracking Computer
Pith X-Type X-Large Shield Booster
Sentient Sensor Booster
Sentient Sensor Booster

Domination Tracking Enhancer
Domination Tracking Enhancer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer

Large Projectile Ambit Extension I
Large Projectile Burst Aerator II

Acolyte II x5
Federation Navy Garde x2

Hail L x1
Optimal Range Script x2
Tracking Speed Script x2
Scan Resolution Script x2`],
      ['dps', 'Intermediate', `[Machariel, WTM VG Shield Machariel]
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
800mm Repeating Cannon II
Small Tractor Beam I

Pithum B-Type Multispectrum Shield Hardener
Federation Navy Tracking Computer
Federation Navy Tracking Computer
Federation Navy Tracking Computer
Shadow Serpentis Sensor Booster
Sentient Sensor Booster

Domination Tracking Enhancer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Syndicate Damage Control

Large EM Shield Reinforcer II
Large EM Shield Reinforcer II
Large Thermal Shield Reinforcer II

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x10

Barrage L x10000
Hail L x10000
Nanite Repair Paste x500
Synth Drop Booster x5
Synth Frentix Booster x5
Optimal Range Script x2
Tracking Speed Script x2
Scan Resolution Script x1
Agency 'Pyrolancea' DB3 Dose I x5
Agency 'Pyrolancea' DB7 Dose III x5`],
      ['dps', 'Intermediate', `[Nightmare, WTM VG Shield Nightmare]
Tachyon Beam Laser II
Tachyon Beam Laser II
Tachyon Beam Laser II
Tachyon Beam Laser II
Corelum A-Type Medium Remote Armor Repairer
Pithum A-Type Medium Remote Shield Booster

Pithum B-Type Multispectrum Shield Hardener
Federation Navy Tracking Computer
Federation Navy Tracking Computer
Federation Navy Tracking Computer
Sentient Sensor Booster
Sentient Sensor Booster
Sentient Sensor Booster

Domination Tracking Enhancer
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Heat Sink
Imperial Navy Capacitor Power Relay

Large EM Shield Reinforcer II
Large EM Shield Reinforcer II
Large Thermal Shield Reinforcer II

Garde II x3

Gleam L x1
Imperial Navy Multifrequency L x1
Imperial Navy Gamma L x1
Imperial Navy Xray L x1
Tracking Speed Script x3
Scan Resolution Script x3
Agency 'Pyrolancea' DB3 Dose I x1`],
      ['dps', 'Intermediate', `[Vindicator, ER VG Vindicator Elite]
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Corpum A-Type Multispectrum Energized Membrane
Corpum A-Type Multispectrum Energized Membrane
Imperial Navy 1600mm Steel Plates

Federation Navy Stasis Webifier
Federation Navy Stasis Webifier
Federation Navy Stasis Webifier
Federation Navy Stasis Webifier
Federation Navy Stasis Webifier

Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II

Large Explosive Armor Reinforcer II
Large Hyperspatial Velocity Optimizer II
Large Hybrid Locus Coordinator II

Imperial Navy Acolyte x5

Null L x10000
Void L x10000
Federation Navy Antimatter Charge L x10000`],
      ['dps', 'Intermediate', `[Vindicator, WTM VG Shield Vindicator]
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II
Neutron Blaster Cannon II

Pithum B-Type Multispectrum Shield Hardener
Dark Blood Stasis Webifier
Dark Blood Stasis Webifier
Dark Blood Stasis Webifier
Sentient Sensor Booster

Domination Tracking Enhancer
Domination Tracking Enhancer
Domination Tracking Enhancer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer
Federation Navy Magnetic Field Stabilizer

Large EM Shield Reinforcer II
Large EM Shield Reinforcer II
Large Thermal Shield Reinforcer II

Garde II x5

Null L x1
Federation Navy Antimatter Charge L x1
Scan Resolution Script x1
Agency 'Pyrolancea' DB3 Dose I x1`],
      ['dps', 'Starter', `[Apocalypse Navy Issue, ER VG Armor Apocalypse Navy Issue]
Damage Control II
Heat Sink II
Heat Sink II
Multispectrum Energized Membrane II
Multispectrum Energized Membrane II
Centum C-Type Kinetic Energized Membrane
Corpum C-Type Explosive Energized Membrane
Imperial Navy 1600mm Steel Plates

Tracking Computer II
Large Compact Pb-Acid Cap Battery
Alumel-Wired Enduring Sensor Booster
Tracking Computer II

Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I

Large Thermal Armor Reinforcer I
Large Hyperspatial Velocity Optimizer I
Large Energy Discharge Elutriation II

Federation Navy Hammerhead x5

Imperial Navy Multifrequency L x40
Imperial Navy Xray L x16
Optimal Range Script x2
Tracking Speed Script x2
Scan Resolution Script x1
Nanite Repair Paste x500
Synth Mindflood Booster x2
Large Micro Jump Drive x1`],
      ['dps', 'Starter', `[Apocalypse Navy Issue, WTM VG Shield Apocalypse Navy]
Damage Control II
Heat Sink II
Heat Sink II
Heat Sink II
Capacitor Power Relay II
Capacitor Power Relay II
Power Diagnostic System II
Power Diagnostic System II

Sensor Booster II
Republic Fleet Large Cap Battery
Multispectrum Shield Hardener II
Multispectrum Shield Hardener II

Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I
Mega Modulated Pulse Energy Beam I

Large Thermal Shield Reinforcer II
Large EM Shield Reinforcer II
Large EM Shield Reinforcer II

Federation Navy Hobgoblin x10
Federation Navy Hammerhead x5

Imperial Navy Multifrequency L x32
Scan Resolution Script x1
Imperial Navy Xray L x24`],
      ['dps', 'Starter', `[Megathron, ER VG Armor Megathron]
Damage Control II
Magnetic Field Stabilizer II
Magnetic Field Stabilizer II
Magnetic Field Stabilizer II
Multispectrum Energized Membrane II
Multispectrum Energized Membrane II
Centum C-Type Explosive Energized Membrane
Imperial Navy 1600mm Steel Plates

Tracking Computer II
Tracking Computer II
Large Compact Pb-Acid Cap Battery
Sensor Booster II

Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I

Large Kinetic Armor Reinforcer I
Large Thermal Armor Reinforcer I
Large Hyperspatial Velocity Optimizer I

Federation Navy Hammerhead x2
Federation Navy Ogre x2

Optimal Range Script x2
Tracking Speed Script x2
Federation Navy Antimatter Charge L x20000
Scan Resolution Script x1
Nanite Repair Paste x500
Federation Navy Tungsten Charge L x10000
Synth Mindflood Booster x2
Large Micro Jump Drive x1`],
      ['dps', 'Starter', `[Megathron, WTM VG Shield Megathron]
Damage Control II
Magnetic Field Stabilizer II
Magnetic Field Stabilizer II
Magnetic Field Stabilizer II
Capacitor Power Relay II
Tracking Enhancer II
Tracking Enhancer II
Capacitor Power Relay II

Multispectrum Shield Hardener II
Multispectrum Shield Hardener II
Tracking Computer II
Republic Fleet Large Cap Battery

Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I
Modal Mega Neutron Particle Accelerator I

Large Thermal Shield Reinforcer II
Large EM Shield Reinforcer II
Large EM Shield Reinforcer II

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x5

Federation Navy Antimatter Charge L x15060
Federation Navy Tungsten Charge L x15000
Tracking Speed Script x1`],
      ['dps', 'Starter', `[Tempest, WTM VG Tempest]
Damage Control II
Gyrostabilizer II
Gyrostabilizer II
Gyrostabilizer II
Tracking Enhancer II
Capacitor Power Relay II

Multispectrum Shield Hardener II
Multispectrum Shield Hardener II
Tracking Computer II
Republic Fleet Large Cap Battery
Tracking Computer II

800mm Heavy 'Scout' Repeating Cannon I
800mm Heavy 'Scout' Repeating Cannon I
800mm Heavy 'Scout' Repeating Cannon I
800mm Heavy 'Scout' Repeating Cannon I
800mm Heavy 'Scout' Repeating Cannon I
800mm Heavy 'Scout' Repeating Cannon I
Large Radiative Scoped Remote Capacitor Transmitter
Small Tractor Beam I

Large Thermal Shield Reinforcer II
Large EM Shield Reinforcer II
Large EM Shield Reinforcer II

Federation Navy Hobgoblin x5
Federation Navy Hammerhead x5

Tracking Speed Script x2
Republic Fleet Phased Plasma L x12000
Republic Fleet EMP L x13440
Optimal Range Script x2`],
    ],
  },
  {
    name: 'WTM Incursion Vanguard Logi',
    fits: [
      ['logi', '', `[Scimitar, WTM VG Scimitar L5]
Large Remote Shield Booster II
Large Remote Shield Booster II
Large Remote Shield Booster II
Large Remote Shield Booster II

Multispectrum Shield Hardener II
Shadow Serpentis Remote Tracking Computer
Shadow Serpentis Remote Tracking Computer
Shadow Serpentis Remote Tracking Computer
Shadow Serpentis Remote Tracking Computer

Capacitor Power Relay II
Capacitor Power Relay II
Capacitor Power Relay II
Damage Control II

Medium Ancillary Current Router II
Medium Capacitor Control Circuit II

Acolyte II x5
Medium Armor Maintenance Bot II x1
Medium Hull Maintenance Bot II x1

Nanite Repair Paste x50
Optimal Range Script x5
Tracking Speed Script x6`],
      ['logi', '', `[Nestor, ER VG Nestor Elite]
Centum A-Type Multispectrum Energized Membrane
Centum A-Type Multispectrum Energized Membrane
Corpus X-Type Large Armor Repairer
Corpus X-Type Large Armor Repairer
Imperial Navy 1600mm Steel Plates
Syndicate Damage Control

Imperial Navy Cap Recharger
Imperial Navy Cap Recharger
Imperial Navy Cap Recharger
Sentient Sensor Booster
Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery

Auto Targeting System II
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer
'Peace' Large Remote Armor Repairer

Large Remote Repair Augmentor II
Large Remote Repair Augmentor II
Large Hyperspatial Velocity Optimizer II

Heavy Shield Maintenance Bot I x5
Heavy Armor Maintenance Bot I x5
Federation Navy Garde x5
Heavy Hull Maintenance Bot I x5

Scan Resolution Script x1`],
    ],
  },
  {
    name: 'WTM Incursion Vanguard Support',
    fits: [
      ['boost', '', `[Claymore, VG Claymore]
Dark Blood Capacitor Power Relay
Dark Blood Capacitor Power Relay
Dark Blood Capacitor Power Relay
Sentient Signal Amplifier

Republic Fleet Large Cap Battery
Sentient Remote Sensor Booster
Sentient Remote Sensor Booster
Sentient Remote Sensor Booster
Shadow Serpentis Remote Sensor Booster
Pithum A-Type Multispectrum Shield Hardener

Shield Command Burst II
Shield Command Burst II
Skirmish Command Burst II
Skirmish Command Burst II
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster
Pithum A-Type Medium Remote Shield Booster

Medium Command Processor I
Medium Command Processor I

Active Shielding Charge x1182
Shield Harmonizing Charge x1182
Scan Resolution Script x4
Evasive Maneuvers Charge x1182
Interdiction Maneuvers Charge x1182
Nanite Repair Paste x200
Shield Command Burst II x1`],
      ['boost', '', `[Eos, WTM VG Armor Eos]
Centii A-Type Multispectrum Coating
Centii A-Type Multispectrum Coating
Corpum A-Type Explosive Energized Membrane
Centum A-Type Multispectrum Energized Membrane
Imperial Navy 1600mm Steel Plates
Imperial Navy Drone Damage Amplifier
Syndicate Damage Control

Federation Navy Remote Tracking Computer
Federation Navy Remote Tracking Computer
Federation Navy Remote Tracking Computer
Federation Navy Remote Tracking Computer

Small Murky Compact Remote Shield Booster
Armor Command Burst II
Armor Command Burst II
Armor Command Burst II
Skirmish Command Burst II

Medium Command Processor I
Medium Command Processor I

Federation Navy Hammerhead x10
Medium Hull Maintenance Bot II x5

Targeting Range Script x3
Tracking Speed Script x4
Armor Energizing Charge x1900
Rapid Repair Charge x1900
Armor Reinforcement Charge x1900
Scan Resolution Script x3
Interdiction Maneuvers Charge x1900
Nanite Repair Paste x1000
Small Tractor Beam II x1
Medium Micro Jump Drive x1`],
    ],
  },
];
