// Release builds on Windows use the GUI subsystem so no console window appears.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    thingary_lib::run()
}
